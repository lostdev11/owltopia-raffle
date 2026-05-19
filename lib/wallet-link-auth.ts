/**
 * Signed challenge for linking an additional wallet to a primary Owltopia account.
 * The linked wallet must sign; the primary wallet must be signed in (session).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { verifySignIn } from '@/lib/auth-server'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

const LINK_NONCE_TTL_MS = 10 * 60 * 1000

type LinkNoncePayload = { p: string; l: string; exp: number; r: string; v: 1 }

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET or AUTH_SECRET required for wallet link nonce')
  }
  return secret
}

export function generateWalletLinkNonce(primaryWallet: string, linkedWallet: string): string {
  const primary = normalizeSolanaWalletAddress(primaryWallet)
  const linked = normalizeSolanaWalletAddress(linkedWallet)
  if (!primary || !linked || walletsEqualSolana(primary, linked)) {
    throw new Error('Invalid wallets for link nonce')
  }
  const secret = getSecret()
  const payload: LinkNoncePayload = {
    p: primary,
    l: linked,
    exp: Date.now() + LINK_NONCE_TTL_MS,
    r: `${Date.now()}:${Math.random()}`,
    v: 1,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

export function consumeWalletLinkNonce(
  nonce: string,
  primaryWallet: string,
  linkedWallet: string
): boolean {
  const primary = normalizeSolanaWalletAddress(primaryWallet)
  const linked = normalizeSolanaWalletAddress(linkedWallet)
  if (!primary || !linked) return false

  const [payloadB64, sigB64] = (nonce || '').split('.')
  if (!payloadB64 || !sigB64) return false
  try {
    const secret = getSecret()
    const expected = createHmac('sha256', secret).update(payloadB64).digest()
    const got = Buffer.from(sigB64, 'base64url')
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Partial<LinkNoncePayload>
    if (payload.v !== 1) return false
    if (typeof payload.p !== 'string' || typeof payload.l !== 'string' || typeof payload.exp !== 'number') {
      return false
    }
    if (!walletsEqualSolana(payload.p, primary)) return false
    if (!walletsEqualSolana(payload.l, linked)) return false
    if (payload.exp < Date.now()) return false
    if (payload.exp > Date.now() + LINK_NONCE_TTL_MS + 30_000) return false
    return true
  } catch {
    return false
  }
}

function linkSiteHost(): string {
  try {
    return new URL(getSiteBaseUrl()).host
  } catch {
    return 'owltopia.xyz'
  }
}

function formatLinkExpiry(expiresAt: Date): string {
  return (
    expiresAt.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' UTC'
  )
}

export function buildWalletLinkMessage(
  primaryWallet: string,
  linkedWallet: string,
  nonce: string,
  expiresAt: Date
): string {
  const host = linkSiteHost()
  const primary = normalizeSolanaWalletAddress(primaryWallet) ?? primaryWallet.trim()
  const linked = normalizeSolanaWalletAddress(linkedWallet) ?? linkedWallet.trim()
  return [
    `Link wallet to ${host}`,
    '',
    `This links the wallet below to your primary ${PLATFORM_NAME} account. No transaction or fee.`,
    '',
    `Primary wallet: ${primary}`,
    `Linked wallet: ${linked}`,
    `Nonce: ${nonce}`,
    `Valid until: ${formatLinkExpiry(expiresAt)}`,
  ].join('\n')
}

export function parseNonceFromWalletLinkMessage(message: string): string | null {
  const match = message.match(/(?:^|\n)Nonce:\s*([^\n]+)/i)
  return match?.[1]?.trim() ?? null
}

export function parseWalletsFromWalletLinkMessage(
  message: string
): { primary: string; linked: string } | null {
  const primaryMatch = message.match(/(?:^|\n)Primary wallet:\s*([^\n]+)/i)
  const linkedMatch = message.match(/(?:^|\n)Linked wallet:\s*([^\n]+)/i)
  const primary = primaryMatch?.[1]?.trim()
  const linked = linkedMatch?.[1]?.trim()
  if (!primary || !linked) return null
  const p = normalizeSolanaWalletAddress(primary)
  const l = normalizeSolanaWalletAddress(linked)
  if (!p || !l) return null
  return { primary: p, linked: l }
}

export function verifyWalletLinkSignature(
  primaryWallet: string,
  linkedWallet: string,
  message: string,
  signatureBase64: string
): { valid: boolean; error?: string } {
  const parsed = parseWalletsFromWalletLinkMessage(message)
  if (!parsed) {
    return { valid: false, error: 'Invalid link message format' }
  }
  if (!walletsEqualSolana(parsed.primary, primaryWallet)) {
    return { valid: false, error: 'Primary wallet mismatch' }
  }
  if (!walletsEqualSolana(parsed.linked, linkedWallet)) {
    return { valid: false, error: 'Linked wallet mismatch' }
  }

  const nonce = parseNonceFromWalletLinkMessage(message)
  if (!nonce || !consumeWalletLinkNonce(nonce, primaryWallet, linkedWallet)) {
    return { valid: false, error: 'Invalid or expired link nonce' }
  }

  return verifySignIn(linkedWallet, message, signatureBase64)
}
