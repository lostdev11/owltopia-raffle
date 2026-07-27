/**
 * Map Switchboard (or other VRF) 32-byte output → draw seed hex for owltopia-draw-v3-vrf.
 * Same winnerIndex formula as v1/v2 once the seed is known.
 */
export function seedFromVrfBytes(bytes: Uint8Array | Buffer | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  if (arr.length < 32) {
    throw new Error(`VRF output must be at least 32 bytes (got ${arr.length})`)
  }
  return Buffer.from(arr.subarray(0, 32)).toString('hex')
}

export function seedFromVrfHex(valueHex: string): string {
  const hex = valueHex.trim().replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(hex) || hex.length < 64) {
    throw new Error('VRF valueHex must be at least 32 bytes of hex')
  }
  return hex.slice(0, 64)
}
