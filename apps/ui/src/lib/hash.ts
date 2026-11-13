/**
 * Deterministic 256-bit hex digest for the prototype.
 * NOT SHA-256. The real application computes SHA-256 over canonical bytes
 * (MVP 9.2). This keeps the chain shape (prev_hash → event_hash) without
 * pulling WebCrypto's async API into synchronous seeding.
 */
function mix(h: number, ch: number) {
  h = Math.imul(h ^ ch, 0x9e3779b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca77)
  h ^= h >>> 13
  return h >>> 0
}

export function hashHex(input: string, bits = 256): string {
  const words = bits / 32
  let out = ''
  for (let w = 0; w < words; w++) {
    let h = 0x811c9dc5 ^ (w * 0x27d4eb2f)
    for (let i = 0; i < input.length; i++) h = mix(h, input.charCodeAt(i))
    h = mix(h, w + 1)
    out += h.toString(16).padStart(8, '0')
  }
  return out
}

export const ZERO_HASH = '0'.repeat(64)

export function shortHash(hex: string, head = 8, tail = 6): string {
  if (!hex) return ''
  if (hex.length <= head + tail + 1) return hex
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`
}

let counter = 0
/** RFC 4122-shaped identifier, deterministic enough for a prototype. */
export function uuid(seed?: string): string {
  counter += 1
  const base = hashHex(`${seed ?? ''}|${counter}|${Date.now()}|${Math.random()}`, 128)
  return `${base.slice(0, 8)}-${base.slice(8, 12)}-4${base.slice(13, 16)}-a${base.slice(17, 20)}-${base.slice(20, 32)}`
}
