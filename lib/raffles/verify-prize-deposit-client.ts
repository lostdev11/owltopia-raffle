/**
 * Client-side: POST verify-prize-deposit with retries so RPC/indexing lag on mobile
 * does not strand users after a successful on-chain transfer.
 */

import bs58 from 'bs58'
import { umiSignatureToBase58 } from '@/lib/solana/umi-signature'

/** Strip whitespace; extract base58 sig from Solscan/explorer URLs; trim query strings. */
export function normalizeDepositTxSignatureInput(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return ''

  const tryExtractFromPath = (pathOrUrl: string): string | null => {
    const m = pathOrUrl.match(/\/(?:tx|transaction)\/([1-9A-HJ-NP-Za-km-z]+)/i)
    return m?.[1] ?? null
  }

  try {
    const u = new URL(s)
    const fromPath = tryExtractFromPath(u.pathname)
    if (fromPath) return fromPath
  } catch {
    const fromLoose = tryExtractFromPath(s)
    if (fromLoose) return fromLoose
  }

  const noQuery = (s.split('?')[0] ?? '').trim()
  const stripped = noQuery.replace(/^[`"'“”]+|[`"'“”]+$/g, '').trim()
  if (/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(stripped)) return stripped

  // UMI bug: String(Uint8Array) → "42,191,137,…" — recover base58 when possible.
  if (/^\d+(,\d+)+$/.test(stripped)) {
    const recovered = umiSignatureToBase58(stripped)
    if (/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(recovered)) return recovered
  }

  for (const part of stripped.split(/\s+/)) {
    const p = part.replace(/^[`'"]|[`'"]$/g, '').split('?')[0]?.trim() ?? ''
    if (/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(p)) return p
  }

  return stripped
}

/** True when `sig` is base58 and decodes to a 64-byte Solana transaction signature. */
export function isValidSolanaTxSignatureBase58(sig: string): boolean {
  const s = (sig ?? '').trim()
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(s)) return false
  try {
    return bs58.decode(s).length === 64
  } catch {
    return false
  }
}

/**
 * Human-readable reason a pasted signature/URL is not a valid Solana tx sig.
 * Returns null when valid after normalize.
 */
export function describeInvalidSolanaTxSignatureInput(raw: string | null | undefined): string | null {
  const normalized = normalizeDepositTxSignatureInput(raw)
  if (!normalized) {
    return 'Paste a Solana transaction signature or Solscan /tx/ link.'
  }
  if (normalized.startsWith('0x') || /^[0-9a-fA-F]{64,66}$/.test(normalized)) {
    return 'That looks like an EVM hash (0x…). Use a Solana signature from Solscan (~87–88 characters, no 0x).'
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(normalized)) {
    return 'Signature must be base58 (Solana). Remove spaces or extra characters.'
  }
  if (isValidSolanaTxSignatureBase58(normalized)) return null

  const len = normalized.length
  if (len < 87 || len > 88) {
    return `Signature length is ${len}; Solana signatures are usually 87–88 characters. Discord/mobile often truncates — copy the full sig from Solscan (or paste the Solscan URL).`
  }
  return 'Signature is not a valid 64-byte Solana transaction signature. Copy the full signature from Solscan.'
}

export const VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS = 14
export const VERIFY_PRIZE_DEPOSIT_RETRY_DELAY_MS = 1000

/** Mirrors POST verify-prize-deposit `frozenEscrowDiagnostics` when the escrow SPL account is frozen. */
export type FrozenEscrowDiagnostics = {
  mint: string
  escrowTokenAccount: string
  freezeAuthority: string | null
}

export type VerifyPrizeDepositClientResult =
  | { ok: true }
  | { ok: false; error: string; status?: number; frozenEscrowDiagnostics?: FrozenEscrowDiagnostics }

/**
 * Server `assertEscrowSplPrizeNotFrozen` rejects with copy containing this phrase when the
 * escrow SPL token account for the mint is frozen (transfer to winner would fail on-chain).
 */
export function isEscrowSplPrizeFrozenVerifyError(message: string): boolean {
  return message.toLowerCase().includes('token account in escrow is frozen')
}

/**
 * Stops immediately on non-retryable 4xx responses.
 * Retries on 503 (RPC/indexing lag after deposit) and 429.
 */
function isRetryableVerifyStatus(status: number): boolean {
  return status === 429 || status === 503 || status >= 500
}

/**
 * Retries on transient outcomes (network, 5xx, 503 lag, and 429).
 * Stops immediately on non-retryable 4xx responses.
 */
export async function verifyPrizeDepositWithRetries(
  raffleId: string,
  options: {
    depositTx?: string | null
    signal?: AbortSignal
    /** Called before each HTTP attempt (1-based index). For deposit progress UI on mobile. */
    onAttempt?: (attemptIndex: number, maxAttempts: number) => void
    /** Defaults to VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS (e.g. create-raffle flow uses more). */
    maxAttempts?: number
    /** Defaults to VERIFY_PRIZE_DEPOSIT_RETRY_DELAY_MS */
    retryDelayMs?: number
  } = {}
): Promise<VerifyPrizeDepositClientResult> {
  const depositTx =
    normalizeDepositTxSignatureInput(options.depositTx?.trim() || '') || null
  const body = depositTx ? JSON.stringify({ deposit_tx: depositTx }) : undefined
  const headers: HeadersInit | undefined = body ? { 'Content-Type': 'application/json' } : undefined
  const maxAttempts = Math.max(1, options.maxAttempts ?? VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS)
  const retryDelayMs = Math.max(100, options.retryDelayMs ?? VERIFY_PRIZE_DEPOSIT_RETRY_DELAY_MS)

  let lastError = 'Verification failed'
  let lastStatus: number | undefined
  let lastFrozenDiagnostics: FrozenEscrowDiagnostics | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      return { ok: false, error: 'Aborted' }
    }

    options.onAttempt?.(attempt + 1, maxAttempts)

    let res: Response
    try {
      res = await fetch(`/api/raffles/${raffleId}/verify-prize-deposit`, {
        method: 'POST',
        headers,
        body,
        credentials: 'include',
        signal: options.signal,
      })
    } catch {
      lastError = 'Network error while verifying deposit'
      lastStatus = undefined
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, retryDelayMs))
      }
      continue
    }

    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      frozenEscrowDiagnostics?: FrozenEscrowDiagnostics
    }
    if (res.ok) {
      return { ok: true }
    }

    lastStatus = res.status
    lastError = typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : 'Verification failed'
    const fd = data?.frozenEscrowDiagnostics
    if (fd && typeof fd.mint === 'string' && typeof fd.escrowTokenAccount === 'string') {
      lastFrozenDiagnostics = {
        mint: fd.mint,
        escrowTokenAccount: fd.escrowTokenAccount,
        freezeAuthority:
          fd.freezeAuthority === null || fd.freezeAuthority === undefined
            ? null
            : typeof fd.freezeAuthority === 'string'
              ? fd.freezeAuthority
              : null,
      }
    }

    const isClientError = res.status >= 400 && res.status < 500
    const isRetryableClientError = isRetryableVerifyStatus(res.status)
    if (isClientError && !isRetryableClientError) {
      return {
        ok: false,
        error: lastError,
        status: res.status,
        ...(lastFrozenDiagnostics ? { frozenEscrowDiagnostics: lastFrozenDiagnostics } : {}),
      }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, retryDelayMs))
    }
  }

  return {
    ok: false,
    error: lastError,
    status: lastStatus,
    ...(lastFrozenDiagnostics ? { frozenEscrowDiagnostics: lastFrozenDiagnostics } : {}),
  }
}

/**
 * Admin session: POST community-giveaway verify-deposit (same retry behavior as raffle verify).
 */
export async function verifyCommunityGiveawayDepositWithRetries(
  giveawayId: string,
  options: {
    depositTx?: string | null
    signal?: AbortSignal
    onAttempt?: (attemptIndex: number, maxAttempts: number) => void
    maxAttempts?: number
    retryDelayMs?: number
  } = {}
): Promise<VerifyPrizeDepositClientResult> {
  const depositTx =
    normalizeDepositTxSignatureInput(options.depositTx?.trim() || '') || null
  const body = depositTx ? JSON.stringify({ deposit_tx: depositTx }) : undefined
  const headers: HeadersInit | undefined = body ? { 'Content-Type': 'application/json' } : undefined
  const maxAttempts = Math.max(1, options.maxAttempts ?? VERIFY_PRIZE_DEPOSIT_MAX_ATTEMPTS)
  const retryDelayMs = Math.max(100, options.retryDelayMs ?? VERIFY_PRIZE_DEPOSIT_RETRY_DELAY_MS)

  let lastError = 'Verification failed'
  let lastStatus: number | undefined
  let lastFrozenDiagnostics: FrozenEscrowDiagnostics | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      return { ok: false, error: 'Aborted' }
    }

    options.onAttempt?.(attempt + 1, maxAttempts)

    let res: Response
    try {
      res = await fetch(`/api/admin/community-giveaways/${giveawayId}/verify-deposit`, {
        method: 'POST',
        headers,
        body,
        credentials: 'include',
        signal: options.signal,
      })
    } catch {
      lastError = 'Network error while verifying deposit'
      lastStatus = undefined
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, retryDelayMs))
      }
      continue
    }

    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      frozenEscrowDiagnostics?: FrozenEscrowDiagnostics
    }
    if (res.ok) {
      return { ok: true }
    }

    lastStatus = res.status
    lastError = typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : 'Verification failed'
    const fd = data?.frozenEscrowDiagnostics
    if (fd && typeof fd.mint === 'string' && typeof fd.escrowTokenAccount === 'string') {
      lastFrozenDiagnostics = {
        mint: fd.mint,
        escrowTokenAccount: fd.escrowTokenAccount,
        freezeAuthority:
          fd.freezeAuthority === null || fd.freezeAuthority === undefined
            ? null
            : typeof fd.freezeAuthority === 'string'
              ? fd.freezeAuthority
              : null,
      }
    }

    const isClientError = res.status >= 400 && res.status < 500
    const isRetryableClientError = isRetryableVerifyStatus(res.status)
    if (isClientError && !isRetryableClientError) {
      return {
        ok: false,
        error: lastError,
        status: res.status,
        ...(lastFrozenDiagnostics ? { frozenEscrowDiagnostics: lastFrozenDiagnostics } : {}),
      }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, retryDelayMs))
    }
  }

  return {
    ok: false,
    error: lastError,
    status: lastStatus,
    ...(lastFrozenDiagnostics ? { frozenEscrowDiagnostics: lastFrozenDiagnostics } : {}),
  }
}
