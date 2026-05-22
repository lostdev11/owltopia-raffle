/**
 * Signed challenge for nesting safeguards acknowledgment (session-only gate in UI).
 * The connected wallet signs; no SIWS session required.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { verifySignIn } from '@/lib/auth-server'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import { NESTING_SECURITY_ACK_STATEMENT } from '@/lib/nesting/security-notice-content'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export { NESTING_SECURITY_ACK_STATEMENT }

const ACK_NONCE_TTL_MS = 10 * 60 * 1000

type AckNoncePayload = { w: string; exp: number; r: string; v: 1 }

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET or AUTH_SECRET required for nesting security ack nonce')
  }
  return secret
}

export function generateNestingSecurityAckNonce(wallet: string): string {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) throw new Error('Invalid wallet for security ack nonce')
  const secret = getSecret()
  const payload: AckNoncePayload = {
    w: normalized,
    exp: Date.now() + ACK_NONCE_TTL_MS,
    r: `${Date.now()}:${Math.random()}`,
    v: 1,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

export function consumeNestingSecurityAckNonce(nonce: string, wallet: string): boolean {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) return false

  const dot = nonce.indexOf('.')
  if (dot < 0) return false
  const payloadB64 = nonce.slice(0, dot)
  const sigB64 = nonce.slice(dot + 1)
  if (!payloadB64 || !sigB64) return false
  try {
    const secret = getSecret()
    const expected = createHmac('sha256', secret).update(payloadB64).digest()
    const got = Buffer.from(sigB64, 'base64url')
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Partial<AckNoncePayload>
    if (payload.v !== 1) return false
    if (typeof payload.w !== 'string' || typeof payload.exp !== 'number') return false
    if (normalizeSolanaWalletAddress(payload.w) !== normalized) return false
    if (payload.exp < Date.now()) return false
    if (payload.exp > Date.now() + ACK_NONCE_TTL_MS + 30_000) return false
    return true
  } catch {
    return false
  }
}

function ackSiteHost(): string {
  try {
    return new URL(getSiteBaseUrl()).host
  } catch {
    return 'owltopia.xyz'
  }
}

function formatAckExpiry(expiresAt: Date): string {
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

export function buildNestingSecurityAckMessage(wallet: string, nonce: string, expiresAt: Date): string {
  const host = ackSiteHost()
  const w = normalizeSolanaWalletAddress(wallet) ?? wallet.trim()
  return [
    `Acknowledge nesting safeguards for ${host}`,
    '',
    NESTING_SECURITY_ACK_STATEMENT,
    '',
    `This signature does not send a transaction or charge a fee. ${PLATFORM_NAME} uses it only to confirm you reviewed the safeguards before opening a new nest.`,
    '',
    `Wallet: ${w}`,
    `Nonce: ${nonce}`,
    `Valid until: ${formatAckExpiry(expiresAt)}`,
  ].join('\n')
}

export function parseNonceFromNestingSecurityAckMessage(message: string): string | null {
  const match = message.match(/(?:^|\n)Nonce:\s*([^\n]+)/i)
  return match?.[1]?.trim() ?? null
}

export function parseWalletFromNestingSecurityAckMessage(message: string): string | null {
  const match = message.match(/(?:^|\n)Wallet:\s*([^\n]+)/i)
  const raw = match?.[1]?.trim()
  if (!raw) return null
  return normalizeSolanaWalletAddress(raw)
}

export function verifyNestingSecurityAckSignature(
  wallet: string,
  message: string,
  signatureBase64: string
): { valid: boolean; error?: string } {
  const parsedWallet = parseWalletFromNestingSecurityAckMessage(message)
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized || !parsedWallet || parsedWallet !== normalized) {
    return { valid: false, error: 'Wallet mismatch' }
  }
  if (!message.includes(NESTING_SECURITY_ACK_STATEMENT)) {
    return { valid: false, error: 'Invalid acknowledgment message' }
  }

  const nonce = parseNonceFromNestingSecurityAckMessage(message)
  if (!nonce || !consumeNestingSecurityAckNonce(nonce, wallet)) {
    return { valid: false, error: 'Invalid or expired acknowledgment nonce' }
  }

  return verifySignIn(wallet, message, signatureBase64)
}
