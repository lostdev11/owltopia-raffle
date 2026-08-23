/**
 * Owl Center Generator / Sugar exports are 0-based (0.png … N-1.png).
 * Owltopia Coins on-chain are #1 … #N. Remap indices / manifest keys +1.
 */

export function isZeroBasedContiguousIndices(indices: number[]): boolean {
  const unique = [...new Set(indices.filter((n) => Number.isInteger(n) && n >= 0))].sort(
    (a, b) => a - b
  )
  if (unique.length === 0) return false
  if (unique[0] !== 0) return false
  return unique[unique.length - 1] === unique.length - 1
}

/** Shift manifest keys 0..N-1 → 1..N. No-op when not zero-based. */
export function remapZeroBasedManifestKeys<T extends { image?: string; metadata: string }>(
  manifest: Record<string, T>
): { manifest: Record<string, T>; remapped: boolean } {
  const keys = Object.keys(manifest)
    .map((k) => Number.parseInt(k, 10))
    .filter((n) => Number.isInteger(n) && n >= 0)
  if (!isZeroBasedContiguousIndices(keys)) {
    return { manifest, remapped: false }
  }
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(manifest)) {
    const n = Number.parseInt(k, 10)
    if (!Number.isInteger(n)) continue
    out[String(n + 1)] = v
  }
  return { manifest: out, remapped: true }
}

/** Rewrite Sugar-style name/description token numbers after a +1 index remap. */
export function bumpMetadataJsonTokenNumber(rawJson: string, fromIndex: number, toIndex: number): string {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>
    if (typeof parsed.name === 'string') {
      parsed.name = parsed.name
        .replace(new RegExp(`#\\s*${fromIndex}\\b`), `#${toIndex}`)
        .replace(new RegExp(`\\b${fromIndex}$`), String(toIndex))
    }
    if (typeof parsed.description === 'string') {
      parsed.description = parsed.description
        .replace(new RegExp(`Token\\s+${fromIndex}\\b`, 'i'), `Token ${toIndex}`)
        .replace(new RegExp(`#\\s*${fromIndex}\\b`), `#${toIndex}`)
    }
    return JSON.stringify(parsed, null, 2)
  } catch {
    return rawJson
  }
}
