/**
 * Adaptive token-scatter packing — fewer Solana txs for large airdrops.
 *
 * Byte budgets measured with compute-budget + Owl fee + SPL transfer (± createATA):
 * - createATA + transfer ≈ +88 bytes / recipient
 * - transfer only ≈ +47 bytes / recipient
 * Stay ≤ OWL_SEND_TX_SAFE_BYTES so Phantom/Jupiter Lighthouse injection still fits.
 */

import {
  OWL_SEND_MAX_PER_TX_TOKEN,
} from '@/lib/owl-send/constants'
import { OWL_SEND_TX_SAFE_BYTES_TOKEN } from '@/lib/owl-send/tx-size'

/** Serialized-size overhead before the first transfer line (CU + fee + shared keys). */
const TOKEN_TX_BASE_BYTES = 331

/** Extra bytes when the first line needs createATA (shared mint/program keys already counted). */
const TOKEN_TX_CREATE_ATA_BASE_EXTRA = 64

/** Per-recipient createATA + transfer. */
export const OWL_SEND_TOKEN_BYTES_PER_CREATE_ATA = 88

/** Per-recipient transfer when dest ATA already exists. */
export const OWL_SEND_TOKEN_BYTES_PER_EXISTING_ATA = 47

export function estimateOwlSendTokenScatterTxBytes(params: {
  createAtaCount: number
  existingAtaCount: number
}): number {
  const c = Math.max(0, Math.floor(params.createAtaCount))
  const e = Math.max(0, Math.floor(params.existingAtaCount))
  if (c + e < 1) return TOKEN_TX_BASE_BYTES
  const base = c > 0 ? TOKEN_TX_BASE_BYTES + TOKEN_TX_CREATE_ATA_BASE_EXTRA : TOKEN_TX_BASE_BYTES
  return base + c * OWL_SEND_TOKEN_BYTES_PER_CREATE_ATA + e * OWL_SEND_TOKEN_BYTES_PER_EXISTING_ATA
}

/**
 * Pack token-scatter lines into as few txs as possible under the safe packet budget.
 * `needsCreateAta[i]` true ⇒ recipient needs a new ATA for this mint (worst-case size).
 */
export function packOwlSendTokenScatterLines<T>(
  lines: T[],
  needsCreateAta: boolean[],
  opts?: { maxPerTx?: number; safeBytes?: number }
): T[][] {
  if (lines.length !== needsCreateAta.length) {
    throw new Error('packOwlSendTokenScatterLines: lines and needsCreateAta length mismatch')
  }
  const maxPer = Math.max(1, Math.floor(opts?.maxPerTx ?? OWL_SEND_MAX_PER_TX_TOKEN))
  const safe = Math.max(200, Math.floor(opts?.safeBytes ?? OWL_SEND_TX_SAFE_BYTES_TOKEN))

  const chunks: T[][] = []
  let cur: T[] = []
  let createCount = 0
  let existingCount = 0

  const flush = () => {
    if (cur.length < 1) return
    chunks.push(cur)
    cur = []
    createCount = 0
    existingCount = 0
  }

  for (let i = 0; i < lines.length; i++) {
    const needsAta = needsCreateAta[i] === true
    const nextCreate = createCount + (needsAta ? 1 : 0)
    const nextExisting = existingCount + (needsAta ? 0 : 1)
    const nextBytes = estimateOwlSendTokenScatterTxBytes({
      createAtaCount: nextCreate,
      existingAtaCount: nextExisting,
    })

    if (cur.length > 0 && (cur.length >= maxPer || nextBytes > safe)) {
      flush()
    }

    // After flush, recompute for a fresh chunk (single line always allowed even if over — peel later).
    if (cur.length === 0) {
      cur.push(lines[i]!)
      createCount = needsAta ? 1 : 0
      existingCount = needsAta ? 0 : 1
      continue
    }

    cur.push(lines[i]!)
    createCount = nextCreate
    existingCount = nextExisting
  }
  flush()
  return chunks
}

/** How many approvals a flat token list needs with the given ATA flags. */
export function countOwlSendTokenScatterApprovals(
  needsCreateAta: boolean[],
  opts?: { maxPerTx?: number; safeBytes?: number }
): number {
  return packOwlSendTokenScatterLines(
    needsCreateAta.map((_, i) => i),
    needsCreateAta,
    opts
  ).length
}
