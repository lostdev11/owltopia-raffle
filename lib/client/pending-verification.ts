/**
 * Crash-safe record of "payment sent, tickets not yet confirmed" purchases.
 *
 * Mobile wallet redirects (Phantom/Solflare deep links, MWA) frequently background or
 * reload the tab between `sendTransaction` and `/api/entries/verify`. When that JS
 * continuation dies, the payment is on-chain but the entry stays pending — previously
 * requiring admin intervention. We persist {entryIds, signature} to localStorage the
 * moment the wallet returns a signature, and re-run verify on the next page load /
 * tab foreground until the server confirms or definitively rejects.
 *
 * Pure helpers (parse/upsert/remove/prune) are storage-agnostic so they can be unit
 * tested in node (see scripts/test-pending-verification-store.ts).
 */

export type PendingVerificationKind = 'single' | 'batch'

export type PendingVerificationRecord = {
  kind: PendingVerificationKind
  entryIds: string[]
  transactionSignature: string
  walletAddress: string
  createdAt: number
  failCount: number
}

export const PENDING_VERIFICATIONS_STORAGE_KEY = 'owl_pending_ticket_verifications_v1'

/** Older than this nothing will recover (raffle likely ended; admin tools take over). */
export const PENDING_VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Definitive 4xx rejections from verify before we stop retrying this signature. */
export const PENDING_VERIFICATION_MAX_FAILURES = 6

// ---------------------------------------------------------------------------
// Pure helpers (no window / storage access)
// ---------------------------------------------------------------------------

export function parsePendingVerifications(raw: string | null): PendingVerificationRecord[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: PendingVerificationRecord[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const kind = o.kind === 'batch' ? 'batch' : o.kind === 'single' ? 'single' : null
      const sig = typeof o.transactionSignature === 'string' ? o.transactionSignature.trim() : ''
      const wallet = typeof o.walletAddress === 'string' ? o.walletAddress.trim() : ''
      const entryIds = Array.isArray(o.entryIds)
        ? o.entryIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : []
      if (!kind || sig.length < 80 || !wallet || entryIds.length === 0) continue
      out.push({
        kind,
        entryIds,
        transactionSignature: sig,
        walletAddress: wallet,
        createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now(),
        failCount: typeof o.failCount === 'number' && Number.isFinite(o.failCount) ? Math.max(0, Math.floor(o.failCount)) : 0,
      })
    }
    return out
  } catch {
    return []
  }
}

/** Insert or replace by transaction signature (one record per payment). */
export function upsertPendingVerification(
  records: PendingVerificationRecord[],
  record: PendingVerificationRecord
): PendingVerificationRecord[] {
  const sig = record.transactionSignature.trim()
  return [...records.filter(r => r.transactionSignature !== sig), { ...record, transactionSignature: sig }]
}

export function removePendingVerification(
  records: PendingVerificationRecord[],
  transactionSignature: string
): PendingVerificationRecord[] {
  const sig = transactionSignature.trim()
  return records.filter(r => r.transactionSignature !== sig)
}

export function markPendingVerificationFailure(
  records: PendingVerificationRecord[],
  transactionSignature: string
): PendingVerificationRecord[] {
  const sig = transactionSignature.trim()
  return records.map(r =>
    r.transactionSignature === sig ? { ...r, failCount: r.failCount + 1 } : r
  )
}

export function prunePendingVerifications(
  records: PendingVerificationRecord[],
  now: number = Date.now()
): PendingVerificationRecord[] {
  return records.filter(
    r =>
      r.failCount < PENDING_VERIFICATION_MAX_FAILURES &&
      now - r.createdAt < PENDING_VERIFICATION_MAX_AGE_MS
  )
}

// ---------------------------------------------------------------------------
// localStorage-bound API (browser only; silently no-ops when unavailable)
// ---------------------------------------------------------------------------

function readStore(): PendingVerificationRecord[] {
  if (typeof window === 'undefined') return []
  try {
    return parsePendingVerifications(window.localStorage.getItem(PENDING_VERIFICATIONS_STORAGE_KEY))
  } catch {
    return []
  }
}

function writeStore(records: PendingVerificationRecord[]): void {
  if (typeof window === 'undefined') return
  try {
    if (records.length === 0) {
      window.localStorage.removeItem(PENDING_VERIFICATIONS_STORAGE_KEY)
    } else {
      window.localStorage.setItem(PENDING_VERIFICATIONS_STORAGE_KEY, JSON.stringify(records))
    }
  } catch {
    /* private mode / quota — degrade to old behavior */
  }
}

/** Call as soon as the wallet returns a signature (before attach/verify can fail). */
export function recordPendingVerification(input: {
  kind: PendingVerificationKind
  entryIds: string[]
  transactionSignature: string
  walletAddress: string
}): void {
  writeStore(
    upsertPendingVerification(readStore(), {
      ...input,
      createdAt: Date.now(),
      failCount: 0,
    })
  )
}

/** Call once verify succeeds or the tx definitively failed on-chain. */
export function clearPendingVerification(transactionSignature: string): void {
  writeStore(removePendingVerification(readStore(), transactionSignature))
}

let resumeInFlight = false

/**
 * Re-run verify for every stored record. Safe to call repeatedly (mount, tab
 * foreground, return from wallet app); concurrent calls are coalesced.
 * Verify is idempotent server-side: an entry already confirmed with the same
 * signature returns 200, so duplicated attempts only clear the record.
 */
export async function resumePendingVerifications(opts?: {
  /** Runs once when at least one stored payment got confirmed (e.g. router.refresh). */
  onConfirmed?: () => void
}): Promise<void> {
  if (typeof window === 'undefined' || resumeInFlight) return
  const pruned = prunePendingVerifications(readStore())
  writeStore(pruned)
  if (pruned.length === 0) return

  resumeInFlight = true
  let confirmedAny = false
  try {
    for (const rec of pruned) {
      try {
        const res = await fetch(rec.kind === 'batch' ? '/api/entries/verify-batch' : '/api/entries/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(
            rec.kind === 'batch'
              ? { entryIds: rec.entryIds, transactionSignature: rec.transactionSignature }
              : { entryId: rec.entryIds[0], transactionSignature: rec.transactionSignature }
          ),
        })

        if (res.status === 202) {
          // Chain still indexing — keep for the next resume pass.
          continue
        }
        if (res.ok) {
          clearPendingVerification(rec.transactionSignature)
          confirmedAny = true
          continue
        }
        if (res.status === 429 || res.status >= 500) {
          // Rate limit / server hiccup — keep without counting a failure.
          continue
        }
        // Definitive 4xx (sig used elsewhere, on-chain failure, amount mismatch…)
        writeStore(markPendingVerificationFailure(readStore(), rec.transactionSignature))
      } catch {
        /* network error (common right after wallet return) — keep for next pass */
      }
    }
  } finally {
    resumeInFlight = false
  }
  if (confirmedAny) opts?.onConfirmed?.()
}
