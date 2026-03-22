// stdout IS RESERVED for MCP JSON-RPC protocol.
// ALL logs go only through stderr.

export const logger = {
  info: (msg: string, ...args: unknown[]) =>
    console.error(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) =>
    console.error(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) =>
    console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env['DEBUG']) console.error(`[DEBUG] ${msg}`, ...args)
  },
}
