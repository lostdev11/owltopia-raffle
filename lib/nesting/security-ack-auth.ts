/**
 * Signed challenge for nesting safeguards acknowledgment (session-only gate in UI).
 * The connected wallet signs; no SIWS session required.
 * Ledger via Phantom/Solflare often cannot complete off-chain signMessage — use memo-tx verify.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { verifySignIn } from '@/lib/auth-server'
import { verifySignInMemoTransaction } from '@/lib/auth-tx-sign-in'
import { getSiteBaseUrl } from '@/lib/site-config'
import { NESTING_SECURITY_ACK_STATEMENT } from '@/lib/nesting/security-notice-content'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export { NESTING_SECURITY_ACK_STATEMENT }

const ACK_NONCE_TTL_MS = 10 * 60 * 1000
const ACK_NONCE_V2 = 2
const ACK_NONCE_V2_BYTES = 25

type AckNoncePayload = { w: string; exp: number; r: string; v: 1 | 2 }

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET or AUTH_SECRET required for nesting security ack nonce')
  }
  return secret
}

export function generateNestingSecurityAckNonce(wallet: string, expiresAtMs?: number): string {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) throw new Error('Invalid wallet for security ack nonce')
  const secret = getSecret()
  const exp = expiresAtMs ?? Date.now() + ACK_NONCE_TTL_MS
  const buf = Buffer.alloc(ACK_NONCE_V2_BYTES)
  buf.writeUInt8(ACK_NONCE_V2, 0)
  buf.writeBigUInt64BE(BigInt(exp), 1)
  randomBytes(16).copy(buf, 9)
  const payloadB64 = buf.toString('base64url')
  const sig = createHmac('sha256', secret).update(`${normalized}|${payloadB64}`).digest('base64url')
  return `${payloadB64}.${sig}`
}

function peekAckNonceVersion(nonce: string): 1 | 2 | null {
  const [payloadB64] = (nonce || '').split('.')
  if (!payloadB64) return null
  try {
    const buf = Buffer.from(payloadB64, 'base64url')
    if (buf.length === ACK_NONCE_V2_BYTES && buf.readUInt8(0) === ACK_NONCE_V2) return 2
  } catch {
    /* fall through */
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { v?: number }
    if (payload.v === 1) return 1
  } catch {
    /* ignore */
  }
  return null
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
    const got = Buffer.from(sigB64, 'base64url')
    const version = peekAckNonceVersion(nonce)

    if (version === 2) {
      const expected = createHmac('sha256', secret).update(`${normalized}|${payloadB64}`).digest()
      if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false
      const buf = Buffer.from(payloadB64, 'base64url')
      if (buf.length !== ACK_NONCE_V2_BYTES || buf.readUInt8(0) !== ACK_NONCE_V2) return false
      const exp = Number(buf.readBigUInt64BE(1))
      if (!Number.isFinite(exp) || exp < Date.now()) return false
      if (exp > Date.now() + ACK_NONCE_TTL_MS + 30_000) return false
      return true
    }

    if (version === 1) {
      const expected = createHmac('sha256', secret).update(payloadB64).digest()
      if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Partial<AckNoncePayload>
      if (payload.v !== 1) return false
      if (typeof payload.w !== 'string' || typeof payload.exp !== 'number') return false
      if (normalizeSolanaWalletAddress(payload.w) !== normalized) return false
      if (payload.exp < Date.now()) return false
      if (payload.exp > Date.now() + ACK_NONCE_TTL_MS + 30_000) return false
      return true
    }

    return false
  } catch {
    return false
  }
}

function ackSiteHost(): string {
  try {
    return new URL(getSiteBaseUrl()).host
  } catch {
    return 'www.owltopia.xyz'
  }
}

export function buildNestingSecurityAckMessage(wallet: string, nonce: string, expiresAt: Date): string {
  const host = ackSiteHost()
  const w = normalizeSolanaWalletAddress(wallet) ?? wallet.trim()
  // Keep printable ASCII and a short frame so Ledger can display / blind-sign reliably.
  return [
    `Acknowledge nesting safeguards for ${host}`,
    NESTING_SECURITY_ACK_STATEMENT,
    `Wallet: ${w}`,
    `Nonce: ${nonce}`,
    `Exp: ${expiresAt.getTime()}`,
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

function validateNestingSecurityAckMessageShape(
  wallet: string,
  message: string
): { valid: true; nonce: string } | { valid: false; error: string } {
  const parsedWallet = parseWalletFromNestingSecurityAckMessage(message)
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized || !parsedWallet || parsedWallet !== normalized) {
    return { valid: false, error: 'Wallet mismatch' }
  }
  if (!message.includes(NESTING_SECURITY_ACK_STATEMENT)) {
    return { valid: false, error: 'Invalid acknowledgment message' }
  }
  if (!message.includes('Acknowledge nesting safeguards for')) {
    return { valid: false, error: 'Invalid acknowledgment message format' }
  }
  const nonce = parseNonceFromNestingSecurityAckMessage(message)
  if (!nonce) {
    return { valid: false, error: 'Invalid or expired acknowledgment nonce' }
  }
  return { valid: true, nonce }
}

export function verifyNestingSecurityAckSignature(
  wallet: string,
  message: string,
  signatureBase64: string
): { valid: boolean; error?: string } {
  const shape = validateNestingSecurityAckMessageShape(wallet, message)
  if (!shape.valid) return shape

  if (!consumeNestingSecurityAckNonce(shape.nonce, wallet)) {
    return { valid: false, error: 'Invalid or expired acknowledgment nonce' }
  }

  return verifySignIn(wallet, message, signatureBase64)
}

/**
 * Ledger / hardware fallback: verify a signed (unsent) memo transaction that embeds the
 * safeguards challenge as memo data. Same wire format as SIWS verify-tx.
 */
export function verifyNestingSecurityAckMemoTransaction(
  wallet: string,
  message: string,
  signedTransactionBase64: string
): { valid: boolean; error?: string } {
  const shape = validateNestingSecurityAckMessageShape(wallet, message)
  if (!shape.valid) return shape

  const txResult = verifySignInMemoTransaction({
    wallet,
    message,
    signedTransactionBase64,
  })
  if (!txResult.valid) {
    return { valid: false, error: txResult.error || 'Invalid signed transaction' }
  }

  if (!consumeNestingSecurityAckNonce(shape.nonce, wallet)) {
    return { valid: false, error: 'Invalid or expired acknowledgment nonce' }
  }

  return { valid: true }
}
