import { Writable } from 'stream'
import { SAFE_WRITE_TIMEOUT_MS } from '../config.js'

export function safeWrite(stream: Writable, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.destroyed) {
      return reject(new Error('Stream is destroyed'))
    }

    const ok = stream.write(data)
    if (ok) return resolve()

    // If drain is not received within timeout — Codex CLI hung or node-pty
    // does not emit drain as expected. Without a timeout, the await would
    // hang forever.
    const timeout = setTimeout(() => {
      stream.removeListener('drain', onDrain)
      stream.removeListener('error', onError)
      reject(
        new Error(
          `safeWrite timeout: stream drain not received in ${SAFE_WRITE_TIMEOUT_MS}ms`
        )
      )
    }, SAFE_WRITE_TIMEOUT_MS)

    function onDrain() {
      clearTimeout(timeout)
      stream.removeListener('error', onError)
      resolve()
    }

    function onError(err: Error) {
      clearTimeout(timeout)
      stream.removeListener('drain', onDrain)
      reject(err)
    }

    stream.once('drain', onDrain)
    stream.once('error', onError)
  })
}
