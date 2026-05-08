/**
 * Client-side: POST verify-prize-deposit with retries so RPC/indexing lag on mobile
 * does not strand users after a successful on-chain transfer.
 */

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

  for (const part of stripped.split(/\s+/)) {
    const p = part.replace(/^[`'"]|[`'"]$/g, '').split('?')[0]?.trim() ?? ''
    if (/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(p)) return p
  }

  return stripped
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
 * Retries on transient outcomes (network, 5xx, and 429).
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
    const isRetryableClientError = res.status === 429
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
    const isRetryableClientError = res.status === 429
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
