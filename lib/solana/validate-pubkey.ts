import { PublicKey } from '@solana/web3.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_HEX32_RE = /^[0-9a-f]{32}$/i

/** True when value looks like a DB UUID (with or without dashes) — not a Solana address. */
export function looksLikeUuidOrHexId(value: string): boolean {
  const t = value.trim()
  return UUID_RE.test(t) || UUID_HEX32_RE.test(t)
}

export type SolanaPubkeyValidation =
  | { ok: true; pubkey: string }
  | { ok: false; error: string }

/** Validate a user-pasted Solana address with actionable errors for common mistakes. */
export function validateSolanaPubkeyInput(raw: string, label: string): SolanaPubkeyValidation {
  const t = raw.trim()
  if (!t) return { ok: false, error: `${label} is required` }

  if (looksLikeUuidOrHexId(t)) {
    return {
      ok: false,
      error: `${label} looks like an Owl Center launch UUID (${t.slice(0, 8)}…). Paste the base58 address from Sugar cache.json (program.candyMachine / program.collectionMint) — not the launch id from the admin URL.`,
    }
  }

  try {
    return { ok: true, pubkey: new PublicKey(t).toBase58() }
  } catch {
    return {
      ok: false,
      error: `${label} is not a valid Solana address (base58). Copy it from cache.json after sugar deploy.`,
    }
  }
}

/** Optional fields: null/empty passes; non-empty must be valid base58. */
export function validateOptionalSolanaPubkeyInput(
  raw: string | null | undefined,
  label: string
): SolanaPubkeyValidation | { ok: true; pubkey: null } {
  const t = raw?.trim() ?? ''
  if (!t) return { ok: true, pubkey: null }
  const v = validateSolanaPubkeyInput(t, label)
  if (!v.ok) return v
  return { ok: true, pubkey: v.pubkey }
}

/** True when value is a valid Solana base58 address (not a UUID / hex id). */
export function isValidSolanaPubkey(raw: string | null | undefined): boolean {
  const t = raw?.trim() ?? ''
  if (!t) return false
  return validateSolanaPubkeyInput(t, 'Address').ok
}

/** Returns canonical base58 when valid; null when empty or invalid (UUID, malformed, etc.). */
export function sanitizeLaunchMintPubkey(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? ''
  if (!t) return null
  const v = validateSolanaPubkeyInput(t, 'Address')
  return v.ok ? v.pubkey : null
}

/** User-facing hint when DB rows still hold launch UUIDs instead of on-chain addresses. */
export function invalidLaunchMintIdReason(
  candyMachineId: string | null | undefined,
  collectionMint: string | null | undefined
): string | null {
  const cm = candyMachineId?.trim() ?? ''
  const col = collectionMint?.trim() ?? ''
  if (!cm && !col) return null

  const cmBad = cm && !isValidSolanaPubkey(cm)
  const colBad = col && !isValidSolanaPubkey(col)
  if (!cmBad && !colBad) return null

  const sample = (cmBad ? cm : col).slice(0, 8)
  return `Candy Machine IDs are invalid (${sample}… looks like a launch UUID, not a Solana address). Admin: open Phase B → Import cache.json or Deploy CM + guard again — do not paste the launch id from the admin URL.`
}
