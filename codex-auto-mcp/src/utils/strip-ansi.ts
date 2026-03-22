// Own implementation — no external ESM dependency
// Covers: SGR, cursor movement, screen clear, OSC, CSI
const ANSI_REGEX =
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, '')
}
