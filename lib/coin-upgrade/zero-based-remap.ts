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

/**
 * True when the set looks like Generator output (has 0, no N) and should shift +1
 * so on-chain #N gets art. Prefer contiguous 0..N-1; also force when key 0 exists
 * and the natural last on-chain slot (max+1) is absent.
 */
export function shouldRemapZeroBasedKeys(indices: number[]): boolean {
  const unique = [...new Set(indices.filter((n) => Number.isInteger(n) && n >= 0))].sort(
    (a, b) => a - b
  )
  if (unique.length === 0) return false
  if (isZeroBasedContiguousIndices(unique)) return true
  const max = unique[unique.length - 1]!
  return unique[0] === 0 && !unique.includes(max + 1) && unique.length >= max
}

/** Shift every numeric manifest key by delta (e.g. −1 to undo a +1 remap). */
export function shiftManifestKeys<T extends { image?: string; metadata: string }>(
  manifest: Record<string, T>,
  delta: number
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(manifest)) {
    const n = Number.parseInt(k, 10)
    if (!Number.isInteger(n)) continue
    const next = n + delta
    if (next < 0) continue
    out[String(next)] = v
  }
  return out
}

/** Detect whether collection coins are numbered #0…#N or #1…#N on-chain. */
export function detectCoinNumberingScheme(onChainNumbers: Iterable<number>): 'one-based' | 'zero-based' {
  const nums = [...new Set(onChainNumbers)].sort((a, b) => a - b)
  const has1000 = nums.includes(1000)
  const hasZero = nums.includes(0)
  if (has1000 && !hasZero) return 'one-based'
  if (hasZero && !has1000) return 'zero-based'
  const max = nums[nums.length - 1] ?? 0
  if (max <= 999 && nums.length >= 999) return 'zero-based'
  return 'one-based'
}

/**
 * Pick manifest keys to match on-chain numbering.
 * Generator 0.png…999.png → keys 0…999 for #0…#999 coins, or +1 remap for #1…#1000.
 */
export function resolveCatalogManifestForOnChainCoins<T extends { image?: string; metadata: string }>(
  manifestInput: Record<string, T>,
  onChainNumbers: Iterable<number>
): { manifest: Record<string, T>; scheme: 'one-based' | 'zero-based' } {
  const scheme = detectCoinNumberingScheme(onChainNumbers)
  const inputKeys = Object.keys(manifestInput)
    .map((k) => Number.parseInt(k, 10))
    .filter((n) => Number.isInteger(n) && n >= 0)

  if (scheme === 'one-based') {
    return { manifest: remapZeroBasedManifestKeys(manifestInput).manifest, scheme }
  }

  // On-chain #0…#999 — use Generator keys 0…999 (no +1).
  if (shouldRemapZeroBasedKeys(inputKeys)) {
    return { manifest: manifestInput, scheme }
  }
  if (inputKeys.length > 0 && Math.min(...inputKeys) === 1) {
    return { manifest: shiftManifestKeys(manifestInput, -1), scheme }
  }
  return { manifest: manifestInput, scheme }
}

export function remapZeroBasedManifestKeys<T extends { image?: string; metadata: string }>(
  manifest: Record<string, T>
): { manifest: Record<string, T>; remapped: boolean } {
  const keys = Object.keys(manifest)
    .map((k) => Number.parseInt(k, 10))
    .filter((n) => Number.isInteger(n) && n >= 0)
  if (!shouldRemapZeroBasedKeys(keys)) {
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
