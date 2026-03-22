import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import { stripAnsi } from '../utils/strip-ansi.js'
import { logger } from '../utils/logger.js'
import {
  CLI_MODE,
  LINE_FLUSH_DEBOUNCE_MS,
  IDLE_THRESHOLD_MS,
  WAITING_CONFIDENCE_THRESHOLD,
} from '../config.js'
import type { StreamEvent, StreamSource, WaitingHeuristic } from './types.js'

// ─── LineBuffer ───────────────────────────────────────────────────────────────
// ANSI-safe line buffering. Prevents: (a) ANSI code split between chunks,
// (b) ReDoS when running regex over megabyte buffers.

class LineBuffer {
  private raw = ''
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private source: StreamSource,
    private onLine: (text: string, source: StreamSource) => void,
    private debounceMs: number = LINE_FLUSH_DEBOUNCE_MS
  ) {}

  feed(chunk: string): void {
    this.raw += chunk
    this.clearTimer()

    // Extract all complete lines (up to \n)
    let newlineIdx: number
    while ((newlineIdx = this.raw.indexOf('\n')) !== -1) {
      const line = this.raw.slice(0, newlineIdx)
      this.raw = this.raw.slice(newlineIdx + 1)
      // stripAnsi applied ONLY to complete line, NOT to raw buffer
      this.onLine(stripAnsi(line), this.source)
    }

    // If there's a tail without \n — set debounce timer
    // Catches interactive prompts like "Allow create file: foo.ts? (y/n)"
    if (this.raw.length > 0) {
      this.flushTimer = setTimeout(() => this.flush(), this.debounceMs)
    }
  }

  flush(): void {
    this.clearTimer()
    if (this.raw.length > 0) {
      this.onLine(stripAnsi(this.raw), this.source)
      this.raw = ''
    }
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  destroy(): void {
    this.flush()
    this.clearTimer()
  }
}

// ─── StreamParser ─────────────────────────────────────────────────────────────

const PERMISSION_WORDS =
  /\b(allow|approve|permission|confirm|grant|run|execute|create|modify|delete|edit|write)\b/i

const QUESTION_LIKE_SUFFIX = /[?：:]\s*$/

const TRAILING_PROMPT = /(?:\(y\/n\)|\[y\/N\]|\[Y\/n\]|\[yes\/no\])\s*$/i

// Completion markers from codex exec --json
const COMPLETION_MARKERS = [
  /^\{"type":"session_completed"/,
  /^\{"type":"agent_finished"/,
  /^\{"type":"done"/,
  /"status"\s*:\s*"completed"/,
]

export class StreamParser extends EventEmitter {
  private stdoutBuffer: LineBuffer
  private stderrBuffer: LineBuffer
  private mergedEntries: Array<{
    text: string
    source: StreamSource
    timestamp: string
  }> = []

  private lastDataTimestamp = 0
  private lastDataSource: StreamSource | null = null
  private recentTail: string[] = []
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private processAlive = true

  constructor() {
    super()
    this.stdoutBuffer = new LineBuffer('stdout', this.handleLine.bind(this))
    this.stderrBuffer = new LineBuffer('stderr', this.handleLine.bind(this))
  }

  attach(child: ChildProcess): void {
    child.stdout?.on('data', (chunk: Buffer) => {
      this.lastDataTimestamp = Date.now()
      this.lastDataSource = 'stdout'
      this.resetIdleTimer()
      this.stdoutBuffer.feed(chunk.toString())
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      this.lastDataTimestamp = Date.now()
      this.lastDataSource = 'stderr'
      this.resetIdleTimer()
      this.stderrBuffer.feed(chunk.toString())
    })

    child.stdout?.on('end', () => {
      this.stdoutBuffer.destroy()
    })

    child.stderr?.on('end', () => {
      this.stderrBuffer.destroy()
    })

    child.on('exit', (code, signal) => {
      this.processAlive = false
      this.clearIdleTimer()
      this.stdoutBuffer.destroy()
      this.stderrBuffer.destroy()

      const event: StreamEvent = { type: 'process_exit', code, signal }
      this.emit('event', event)

      if (code === 0) {
        const completeEvent: StreamEvent = {
          type: 'task_complete',
          summary: 'Process exited successfully',
          exit_code: 0,
        }
        this.emit('event', completeEvent)
      }
    })

    child.on('error', (err) => {
      this.processAlive = false
      this.clearIdleTimer()
      const event: StreamEvent = { type: 'error', message: err.message }
      this.emit('event', event)
    })
  }

  private handleLine(text: string, source: StreamSource): void {
    const timestamp = new Date().toISOString()
    const trimmed = text.trim()
    if (!trimmed) return

    // Store in merged buffer
    this.mergedEntries.push({ text: trimmed, source, timestamp })
    this.updateRecentTail(trimmed)

    // Emit line event
    const lineEvent: StreamEvent = { type: 'line', text: trimmed, source, timestamp }
    this.emit('event', lineEvent)

    // Check for completion marker
    for (const marker of COMPLETION_MARKERS) {
      if (marker.test(trimmed)) {
        const completeEvent: StreamEvent = {
          type: 'task_complete',
          summary: trimmed,
          exit_code: 0,
        }
        this.emit('event', completeEvent)
        return
      }
    }

    // Check if this looks like a permission request
    if (this.looksLikePermissionCandidate(trimmed)) {
      const candidateEvent: StreamEvent = {
        type: 'permission_candidate',
        text: trimmed,
        timestamp,
      }
      this.emit('event', candidateEvent)
    }
  }

  private looksLikePermissionCandidate(text: string): boolean {
    // JSON approval events
    if (text.includes('"type"') && text.includes('approval')) return true
    if (text.includes('approval_request')) return true

    // Text-based permission patterns
    if (/Allow\s+(?:create|modify|edit|delete|run|command)/i.test(text)) return true
    if (/approve\s+(?:creating|editing|running|writing|modifying)/i.test(text)) return true
    if (TRAILING_PROMPT.test(text) && PERMISSION_WORDS.test(text)) return true

    return false
  }

  private updateRecentTail(text: string): void {
    this.recentTail.push(text)
    if (this.recentTail.length > 20) {
      this.recentTail.shift()
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    if (!this.processAlive) return

    this.idleTimer = setTimeout(() => {
      if (!this.processAlive) return
      const heuristic = this.computeHeuristic()
      if (heuristic.combined_confidence >= WAITING_CONFIDENCE_THRESHOLD) {
        const event: StreamEvent = {
          type: 'waiting_for_input',
          heuristic,
        }
        this.emit('event', event)
      }
    }, IDLE_THRESHOLD_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private computeHeuristic(): WaitingHeuristic {
    const idleMs = Date.now() - this.lastDataTimestamp
    const tail = [...this.recentTail]
    const lastLine = tail[tail.length - 1] ?? ''

    const sawQuestionLikeSuffix = QUESTION_LIKE_SUFFIX.test(lastLine)
    const sawTrailingColonOrPrompt = TRAILING_PROMPT.test(lastLine)
    const sawPermissionWordsWithoutMatch =
      PERMISSION_WORDS.test(lastLine) &&
      !this.looksLikePermissionCandidate(lastLine)

    let confidence = 0

    // +0.3 if idle >= threshold
    if (idleMs >= IDLE_THRESHOLD_MS) confidence += 0.3

    // +0.2 if last data from stdout (pipe mode only, not PTY)
    if (CLI_MODE === 'pipe' && this.lastDataSource === 'stdout') {
      confidence += 0.2
    }
    // PTY mode: last_data_source always 'pty', no +0.2 bonus

    // +0.2 if trailing colon/prompt
    if (sawTrailingColonOrPrompt) confidence += 0.2

    // +0.15 if question-like suffix
    if (sawQuestionLikeSuffix) confidence += 0.15

    // +0.15 if permission words without match
    if (sawPermissionWordsWithoutMatch) confidence += 0.15

    return {
      idle_ms: idleMs,
      recent_tail: tail,
      last_data_source: this.lastDataSource,
      saw_question_like_suffix: sawQuestionLikeSuffix,
      saw_trailing_colon_or_prompt: sawTrailingColonOrPrompt,
      saw_permission_words_without_match: sawPermissionWordsWithoutMatch,
      combined_confidence: Math.min(1.0, confidence),
    }
  }

  getMergedEntries(): Array<{
    text: string
    source: StreamSource
    timestamp: string
  }> {
    // For pipe mode: already merged with timestamps
    // For PTY mode: already a single stream
    return [...this.mergedEntries].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    )
  }

  clearMerged(): void {
    this.mergedEntries = []
    this.recentTail = []
  }

  destroy(): void {
    this.clearIdleTimer()
    this.stdoutBuffer.destroy()
    this.stderrBuffer.destroy()
    this.removeAllListeners()
    logger.debug('StreamParser destroyed')
  }
}
