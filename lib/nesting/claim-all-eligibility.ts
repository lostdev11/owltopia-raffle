import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'

/** Preview → POST carry-forward so Claim all does not re-read every nest lock. */
export const CLAIM_ALL_ELIGIBILITY_TTL_MS = 2 * 60 * 1000

const TOKEN_VERSION = 1

export type ClaimAllEligibilityPayload = {
  v: typeof TOKEN_VERSION
  w: string
  exp: number
  /** Eligible nest ids from preview lock partition (sorted). */
  p: string[]
  feeUnits: number
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET or AUTH_SECRET required for claim-all eligibility token')
  }
  return secret
}

function normalizePositionIds(ids: string[]): string[] {
  const out = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  out.sort()
  for (const id of out) {
    if (!STAKING_UUID_RE.test(id)) {
      throw new Error('Invalid nest id in claim-all eligibility')
    }
  }
  return out
}

export function issueClaimAllEligibilityToken(params: {
  wallet: string
  eligiblePositionIds: string[]
  feeUnits: number
  expiresAtMs?: number
}): string {
  const wallet = normalizeSolanaWalletAddress(params.wallet)
  if (!wallet) throw new Error('Invalid wallet for claim-all eligibility')
  const positionIds = normalizePositionIds(params.eligiblePositionIds)
  if (positionIds.length === 0) throw new Error('Claim-all eligibility requires at least one nest')
  const exp = params.expiresAtMs ?? Date.now() + CLAIM_ALL_ELIGIBILITY_TTL_MS
  const payload: ClaimAllEligibilityPayload = {
    v: TOKEN_VERSION,
    w: wallet,
    exp,
    p: positionIds,
    feeUnits: Math.max(1, Math.floor(params.feeUnits)),
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(`${wallet}|${payloadB64}`).digest('base64url')
  return `${payloadB64}.${sig}`
}

export function verifyClaimAllEligibilityToken(
  token: unknown,
  wallet: string
): ClaimAllEligibilityPayload | null {
  if (typeof token !== 'string' || !token.trim()) return null
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) return null

  const dot = token.indexOf('.')
  if (dot < 0) return null
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)
  if (!payloadB64 || !sigB64) return null

  try {
    const expected = createHmac('sha256', getSecret()).update(`${normalized}|${payloadB64}`).digest()
    const got = Buffer.from(sigB64, 'base64url')
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as ClaimAllEligibilityPayload
    if (payload.v !== TOKEN_VERSION) return null
    if (normalizeSolanaWalletAddress(payload.w) !== normalized) return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (payload.exp > Date.now() + CLAIM_ALL_ELIGIBILITY_TTL_MS + 30_000) return null
    if (!Array.isArray(payload.p) || payload.p.length === 0) return null
    for (const id of payload.p) {
      if (typeof id !== 'string' || !STAKING_UUID_RE.test(id.trim())) return null
    }
    if (!Number.isFinite(payload.feeUnits) || payload.feeUnits < 1) return null
    return payload
  } catch {
    return null
  }
}
