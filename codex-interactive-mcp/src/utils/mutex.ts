export class SessionMutex {
  private locks = new Map<string, Promise<void>>()

  async acquire<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(sessionId) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((r) => {
      release = r
    })
    this.locks.set(sessionId, existing.then(() => next))

    await existing
    try {
      return await fn()
    } finally {
      release()
      // Memory cleanup: remove key if we are the last in queue.
      // Without this, promises accumulate in the Map and closures
      // are not collected by GC on a long-running server.
      if (this.locks.get(sessionId) === next) {
        this.locks.delete(sessionId)
      }
    }
  }

  isLocked(sessionId: string): boolean {
    return this.locks.has(sessionId)
  }

  size(): number {
    return this.locks.size
  }
}
