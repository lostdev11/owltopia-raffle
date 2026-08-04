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

/** Normalize Switchboard randomness `value` field (array / Buffer / Uint8Array) to hex, or null if unset. */
export function extractVrfValueHex(raw: unknown): string | null {
  if (raw == null) return null
  let bytes: Uint8Array | null = null
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    bytes = raw
  } else if (Array.isArray(raw)) {
    if (!raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    bytes = Uint8Array.from(raw as number[])
  }
  if (!bytes || bytes.length < 32) return null
  // Unrevealed accounts keep a zeroed value.
  let anyNonZero = false
  for (let i = 0; i < 32; i++) {
    if (bytes[i] !== 0) {
      anyNonZero = true
      break
    }
  }
  if (!anyNonZero) return null
  return Buffer.from(bytes.subarray(0, 32)).toString('hex')
}

/** True when on-chain randomness already has a reveal (slot and/or non-zero value). */
export function isSwitchboardRandomnessRevealed(data: {
  revealSlot?: { toNumber?: () => number } | number | null
  reveal_slot?: { toNumber?: () => number } | number | null
  value?: unknown
}): boolean {
  const slotRaw = data.revealSlot ?? data.reveal_slot
  const slot =
    typeof slotRaw === 'number'
      ? slotRaw
      : typeof slotRaw?.toNumber === 'function'
        ? slotRaw.toNumber()
        : Number(slotRaw ?? 0)
  if (Number.isFinite(slot) && slot > 0) return true
  return extractVrfValueHex(data.value) != null
}
