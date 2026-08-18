import type { OwlSendLine } from '@/lib/owl-send/batch'
import { chunkOwlSendBatches, chunkOwlSendNftLines } from '@/lib/owl-send/batch'

export type OwlSendBatchProgressSnapshot = {
  index: number
  total: number
  status: 'pending' | 'ready' | 'sending' | 'done' | 'failed'
  signature?: string
  error?: string
  failedMints?: string[]
}

/** Mints from batches already marked done in this session. */
export function collectSentMintsFromBatches(
  batches: OwlSendLine[][],
  progress: Array<{ index: number; status: string }>
): Set<string> {
  const sent = new Set<string>()
  for (const b of progress) {
    if (b.status !== 'done') continue
    for (const line of batches[b.index] ?? []) {
      if (line.mint) sent.add(line.mint)
    }
  }
  return sent
}

/** NFT mints recorded on the send ledger (recent window). */
export function collectSentMintsFromLedger(
  rows: Array<{
    asset_kind: string
    created_at: string
    lines: Array<{ mint?: string | null }>
  }>,
  opts?: { sinceMs?: number; nowMs?: number }
): Set<string> {
  const now = opts?.nowMs ?? Date.now()
  const since = opts?.sinceMs ?? now - 24 * 60 * 60 * 1000
  const sent = new Set<string>()
  for (const row of rows) {
    if (row.asset_kind !== 'nft') continue
    const created = Date.parse(row.created_at)
    if (Number.isFinite(created) && created < since) continue
    for (const line of row.lines) {
      const mint = line.mint?.trim()
      if (mint) sent.add(mint)
    }
  }
  return sent
}

export type ResumeRemainingResult =
  | {
      ok: true
      remaining: OwlSendLine[]
      batches: OwlSendLine[][]
      batchProgress: OwlSendBatchProgressSnapshot[]
      skippedSent: number
      skippedNotHeld: number
    }
  | { ok: false; error: string }

/**
 * Rebuild batches for NFTs still owed: keep original mint→recipient pairing,
 * drop mints already sent (session + ledger) or no longer in the wallet.
 */
export function buildResumeRemainingPlan(params: {
  preparedLines: OwlSendLine[]
  sentMints: Set<string>
  stillHeldMints: Set<string>
}): ResumeRemainingResult {
  if (params.preparedLines.length < 1) {
    return { ok: false, error: 'No prepared send plan to resume.' }
  }

  let skippedSent = 0
  let skippedNotHeld = 0
  const remaining: OwlSendLine[] = []
  for (const line of params.preparedLines) {
    if (params.sentMints.has(line.mint)) {
      skippedSent += 1
      continue
    }
    if (!params.stillHeldMints.has(line.mint)) {
      skippedNotHeld += 1
      continue
    }
    remaining.push(line)
  }

  if (remaining.length < 1) {
    return {
      ok: false,
      error:
        'Nothing left to send — remaining NFTs already left this wallet or were recorded as sent.',
    }
  }

  const batches = chunkOwlSendNftLines(remaining)
  const batchProgress: OwlSendBatchProgressSnapshot[] = batches.map((_, i) => ({
    index: i,
    total: batches.length,
    status: i === 0 ? 'ready' : 'pending',
  }))

  return {
    ok: true,
    remaining,
    batches,
    batchProgress,
    skippedSent,
    skippedNotHeld,
  }
}

export type RebuildSkippingFrozenResult =
  | {
      ok: true
      remaining: OwlSendLine[]
      batches: OwlSendLine[][]
      batchProgress: OwlSendBatchProgressSnapshot[]
      skippedFrozen: number
      skippedSent: number
    }
  | { ok: false; error: string; skippedFrozen: number }

/**
 * Rebuild the confirm-send plan after a failed approval: keep already-sent mints out,
 * drop nested/frozen mints so Retry does not replay the same poison batch forever.
 */
export function buildResumeSkippingFrozenPlan(params: {
  preparedLines: OwlSendLine[]
  batches: OwlSendLine[][]
  batchProgress: Array<{ index: number; status: string }>
  frozenMints: Iterable<string>
  /** Optional: also drop mints no longer held. */
  stillHeldMints?: Set<string>
}): RebuildSkippingFrozenResult {
  const frozen = new Set([...params.frozenMints].map((m) => m.trim()).filter(Boolean))
  const sent = collectSentMintsFromBatches(params.batches, params.batchProgress)
  let skippedFrozen = 0
  let skippedSent = 0
  const remaining: OwlSendLine[] = []

  for (const line of params.preparedLines) {
    const mint = line.mint.trim()
    if (sent.has(mint) || sent.has(line.mint)) {
      skippedSent += 1
      continue
    }
    if (frozen.has(mint)) {
      skippedFrozen += 1
      continue
    }
    if (params.stillHeldMints && !params.stillHeldMints.has(mint) && !params.stillHeldMints.has(line.mint)) {
      continue
    }
    remaining.push(line)
  }

  if (remaining.length < 1) {
    return {
      ok: false,
      skippedFrozen,
      error:
        skippedFrozen > 0
          ? `Nothing left to retry — ${skippedFrozen} nested/frozen NFT${skippedFrozen === 1 ? '' : 's'} must be thawed or unnested first. Use Thaw locks, or Deselect problem NFTs and start a new send.`
          : 'Nothing left to send — remaining NFTs were already sent or left the wallet.',
    }
  }

  const batches = chunkOwlSendNftLines(remaining)
  const batchProgress: OwlSendBatchProgressSnapshot[] = batches.map((_, i) => ({
    index: i,
    total: batches.length,
    status: i === 0 ? 'ready' : 'pending',
  }))

  return {
    ok: true,
    remaining,
    batches,
    batchProgress,
    skippedFrozen,
    skippedSent,
  }
}

export type PartialOwlSendBatchSuccess = {
  batches: OwlSendLine[][]
  batchProgress: OwlSendBatchProgressSnapshot[]
  preparedLines: OwlSendLine[]
  nextIndex: number
  deferredCount: number
}

/**
 * After a prefix of the current approval lands, keep those lines as the completed
 * batch and insert the unsent tail as the next approval(s).
 */
export function applyPartialOwlSendBatchSuccess(params: {
  preparedLines: OwlSendLine[]
  batches: OwlSendLine[][]
  batchProgress: OwlSendBatchProgressSnapshot[]
  batchIndex: number
  sentLines: OwlSendLine[]
  deferredLines: OwlSendLine[]
  signature: string
}): PartialOwlSendBatchSuccess {
  const { batchIndex, sentLines, deferredLines, signature } = params
  const nextBatches = [...params.batches]
  nextBatches[batchIndex] = sentLines
  const extra = chunkOwlSendNftLines(deferredLines)
  nextBatches.splice(batchIndex + 1, 0, ...extra)

  const nextProgress: OwlSendBatchProgressSnapshot[] = nextBatches.map((_, i) => {
    if (i < batchIndex) {
      const prev = params.batchProgress[i]
      return {
        index: i,
        total: nextBatches.length,
        status: prev?.status ?? 'pending',
        signature: prev?.signature,
        error: prev?.error,
        failedMints: prev?.failedMints,
      }
    }
    if (i === batchIndex) {
      return {
        index: i,
        total: nextBatches.length,
        status: 'done',
        signature,
      }
    }
    return {
      index: i,
      total: nextBatches.length,
      status: i === batchIndex + 1 ? 'ready' : 'pending',
    }
  })

  return {
    batches: nextBatches,
    batchProgress: nextProgress,
    preparedLines: nextBatches.flat(),
    nextIndex: batchIndex + 1,
    deferredCount: deferredLines.length,
  }
}

/**
 * Split a failed oversized approval so Retry uses a smaller packet.
 */
export function splitOversizedOwlSendBatch(params: {
  batches: OwlSendLine[][]
  batchProgress: OwlSendBatchProgressSnapshot[]
  batchIndex: number
  error: string
}): { batches: OwlSendLine[][]; batchProgress: OwlSendBatchProgressSnapshot[] } | null {
  const lines = params.batches[params.batchIndex]
  if (!lines || lines.length < 2) return null
  const maxPer = Math.max(1, Math.ceil(lines.length / 2))
  const pieces = chunkOwlSendBatches(lines, maxPer)
  if (pieces.length < 2) return null

  const nextBatches = [...params.batches]
  nextBatches.splice(params.batchIndex, 1, ...pieces)
  const nextProgress: OwlSendBatchProgressSnapshot[] = nextBatches.map((_, i) => {
    if (i < params.batchIndex) {
      const prev = params.batchProgress[i]
      return {
        index: i,
        total: nextBatches.length,
        status: prev?.status ?? 'pending',
        signature: prev?.signature,
        error: prev?.error,
        failedMints: prev?.failedMints,
      }
    }
    if (i === params.batchIndex) {
      return {
        index: i,
        total: nextBatches.length,
        status: 'failed',
        error: params.error,
      }
    }
    const shift = i - (pieces.length - 1)
    const prev = params.batchProgress[shift]
    return {
      index: i,
      total: nextBatches.length,
      status: prev?.status === 'done' ? 'done' : i === params.batchIndex + 1 ? 'pending' : (prev?.status ?? 'pending'),
      signature: prev?.signature,
    }
  })

  return { batches: nextBatches, batchProgress: nextProgress }
}
