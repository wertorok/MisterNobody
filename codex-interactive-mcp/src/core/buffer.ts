import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../utils/logger.js'
import { BUFFER_MAX_BYTES } from '../config.js'
import type { StreamSource } from './types.js'

export interface BufferEntry {
  timestamp: string
  source: StreamSource // 'stdout' | 'stderr' | 'pty'
  text: string
}

export class Buffer {
  private entries: BufferEntry[] = []
  private sizeBytes = 0

  append(entry: BufferEntry): void {
    this.entries.push(entry)
    this.sizeBytes += entry.text.length * 2 // approx UTF-16 size

    if (this.sizeBytes > BUFFER_MAX_BYTES) {
      this.rotate()
    }
  }

  getAll(): BufferEntry[] {
    return [...this.entries]
  }

  getSince(timestamp: string): BufferEntry[] {
    return this.entries.filter((e) => e.timestamp >= timestamp)
  }

  getMerged(): BufferEntry[] {
    // For PTY mode: all entries are already 'pty', no need to sort
    // For pipe mode: merge stdout+stderr by timestamp
    return [...this.entries].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    )
  }

  clear(): void {
    this.entries = []
    this.sizeBytes = 0
  }

  async saveToCycle(cycleId: string, sessionDir: string): Promise<string> {
    const cyclesDir = path.join(sessionDir, 'cycles')
    await fs.promises.mkdir(cyclesDir, { recursive: true })
    const filePath = path.join(cyclesDir, `${cycleId}.log`)
    const content = this.entries
      .map((e) => `[${e.timestamp}][${e.source}] ${e.text}`)
      .join('\n')
    await fs.promises.writeFile(filePath, content, 'utf-8')
    return filePath
  }

  rotate(): void {
    // Archive current entries to a time-stamped log and start fresh
    logger.info(
      `Buffer rotation: ${this.entries.length} entries, ${this.sizeBytes} bytes`
    )
    this.entries = this.entries.slice(-100) // keep last 100 as context
    this.sizeBytes = this.entries.reduce((s, e) => s + e.text.length * 2, 0)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // compress() — deterministic sliding window
  // ──────────────────────────────────────────────────────────────────────────
  //
  // Algorithm: three fixed zones + scoring of the middle zone.
  // Fully deterministic — same input ALWAYS gives same output.
  // Linear complexity O(N) — no sorting, no recursion, one pass over middle.
  //
  compress(maxLines: number): BufferEntry[] {
    const entries = this.getAll()
    if (entries.length <= maxLines) return entries

    const HEAD_RATIO = 0.15
    const TAIL_RATIO = 0.30

    const headSize = Math.max(1, Math.floor(maxLines * HEAD_RATIO))
    const tailSize = Math.max(1, Math.floor(maxLines * TAIL_RATIO))
    const middleBudget = Math.max(0, maxLines - headSize - tailSize)

    const head = entries.slice(0, headSize)
    const tail = entries.slice(-tailSize)
    const middleStart = headSize
    const middleEnd = entries.length - tailSize
    const middle = entries.slice(middleStart, middleEnd)

    if (middle.length === 0 || middleBudget === 0) {
      const marker = this.makeMarker(middle.length)
      return [...head, marker, ...tail]
    }

    // ── Scoring (one pass, O(N)) ──────────────────────────────────────────
    const SEMANTIC_KEYWORDS =
      /\b(plan|action|create|modify|delete|run|execute|install|build|test|deploy|migrate|refactor|because|therefore|next|step|done|skip|warning|error|failed|success|todo)\b/i
    const FILE_PATH_PATTERN =
      /(?:^|[\s'"])(?:\.?\.?\/)?[\w.\-/]+\.(ts|js|tsx|jsx|json|py|rs|go|yaml|yml|toml|sql|prisma|md|txt|css|html|sh|env)\b/
    const ERROR_PATTERN =
      /\b(error|err|fail|exception|panic|fatal|warn|WARN|ERROR|FATAL)\b/

    const scored: Array<{ entry: BufferEntry; score: number; index: number }> =
      []
    for (let i = 0; i < middle.length; i++) {
      const entry = middle[i]
      if (!entry) continue
      const text = entry.text
      let score = 0
      if (SEMANTIC_KEYWORDS.test(text)) score += 1
      if (FILE_PATH_PATTERN.test(text)) score += 1
      if (ERROR_PATTERN.test(text)) score += 1
      scored.push({ entry, score, index: i })
    }

    // ── Select top lines from middle ──────────────────────────────────────
    // Sort: score DESC, then index ASC (tiebreaker — earlier position)
    // Take first middleBudget lines.
    // Then restore original order (sort by index ASC).
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.index - b.index
    })

    const selected = scored
      .slice(0, middleBudget)
      .sort((a, b) => a.index - b.index)

    // ── Assemble result with gap markers ──────────────────────────────────
    const result: BufferEntry[] = [...head]
    let lastOriginalIndex = headSize - 1

    for (const item of selected) {
      const gapStart = lastOriginalIndex + 1
      const gapEnd = middleStart + item.index
      const gap = gapEnd - gapStart
      if (gap > 0) {
        result.push(this.makeMarker(gap))
      }
      result.push(item.entry)
      lastOriginalIndex = middleStart + item.index
    }

    const gapBeforeTail =
      entries.length - tailSize - (lastOriginalIndex + 1)
    if (gapBeforeTail > 0) {
      result.push(this.makeMarker(gapBeforeTail))
    }

    result.push(...tail)
    return result
  }

  private makeMarker(linesSkipped: number): BufferEntry {
    return {
      timestamp: new Date().toISOString(),
      source: 'stderr',
      text: `[...${linesSkipped} lines compressed...]`,
    }
  }
}
