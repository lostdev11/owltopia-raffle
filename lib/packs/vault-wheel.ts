/**
 * Pure math for the Pack Vault circular selector.
 * Display slots are cosmetic theater — they do not map to backend SKUs.
 */

export const SELECTOR_ANGLE = 180
export const PACK_VAULT_SLOT_COUNT = 24

export type VaultPack = {
  index: number
  idLabel: string
}

export function anglePerPack(packCount: number): number {
  if (packCount <= 0) return 0
  return 360 / packCount
}

export function wrapIndex(index: number, packCount: number): number {
  if (packCount <= 0) return 0
  return ((index % packCount) + packCount) % packCount
}

export function slotAngle(index: number, packCount: number): number {
  return wrapIndex(index, packCount) * anglePerPack(packCount)
}

export function normalizeDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  const r = deg % 360
  return r < 0 ? r + 360 : r
}

/** Signed shortest turn from `from` to `to`, in (-180, 180]. */
export function shortestDelta(from: number, to: number): number {
  const a = normalizeDegrees(from)
  const b = normalizeDegrees(to)
  let d = b - a
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

export function angularDistance(a: number, b: number): number {
  return Math.abs(shortestDelta(a, b))
}

export function shortestIndexDelta(from: number, to: number, packCount: number): number {
  if (packCount <= 0) return 0
  let d = wrapIndex(to - from, packCount)
  if (d > packCount / 2) d -= packCount
  return d
}

/**
 * Index whose slot is closest to the fixed bottom selector.
 * Pack 0 rests at the top when rotation is 0; selector is at 180°.
 */
export function nearestIndex(rotation: number, packCount: number): number {
  if (packCount <= 0) return 0
  const step = anglePerPack(packCount)
  return wrapIndex(Math.round((SELECTOR_ANGLE - rotation) / step), packCount)
}

export function snapRotation(index: number, packCount: number): number {
  return SELECTOR_ANGLE - slotAngle(index, packCount)
}

export function formatPackIdLabel(index: number): string {
  return String(index + 1).padStart(4, '0')
}

export function buildVaultPacks(count: number = PACK_VAULT_SLOT_COUNT): VaultPack[] {
  const n = Math.max(1, Math.floor(count))
  return Array.from({ length: n }, (_, index) => ({
    index,
    idLabel: formatPackIdLabel(index),
  }))
}

export function packProximity(rotation: number, index: number, packCount: number): number {
  if (packCount <= 0) return 0
  const world = rotation + slotAngle(index, packCount)
  const dist = angularDistance(world, SELECTOR_ANGLE)
  const step = anglePerPack(packCount)
  const span = step * 1.5
  if (span <= 0) return 1
  return Math.max(0, Math.min(1, 1 - dist / span))
}
