import { OWL_TRANSFER_MAX_PER_TX, OWL_TRANSFER_MAX_SELECT } from '@/lib/owl-transfer/constants'

export type OwlTransferLine = {
  mint: string
  recipient: string
  /** Optional display name */
  name?: string | null
  tokenAccount?: string | null
  image?: string | null
}

/** Cap selection to product max (20). */
export function capOwlTransferSelection<T>(items: T[]): T[] {
  return items.slice(0, OWL_TRANSFER_MAX_SELECT)
}

/** Split lines into wallet-approval batches of ≤5. */
export function chunkOwlTransferBatches<T>(
  items: T[],
  maxPerTx: number = OWL_TRANSFER_MAX_PER_TX
): T[][] {
  const chunks: T[][] = []
  const size = Math.max(1, Math.floor(maxPerTx))
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Pair NFTs 1:1 with recipients for Scatter.
 * When `randomize` is true, shuffle NFT order (recipients stay in pasted order).
 */
export function pairScatterLines(params: {
  mints: Array<{ mint: string; name?: string | null; tokenAccount?: string | null; image?: string | null }>
  recipients: string[]
  randomize?: boolean
}): { ok: true; lines: OwlTransferLine[] } | { ok: false; error: string } {
  const recipients = params.recipients.map((r) => r.trim()).filter(Boolean)
  const mints = [...params.mints]
  if (mints.length === 0) return { ok: false, error: 'Select at least one NFT.' }
  if (recipients.length === 0) return { ok: false, error: 'Add at least one recipient wallet.' }
  if (mints.length !== recipients.length) {
    return {
      ok: false,
      error: `Scatter needs the same number of NFTs and wallets (${mints.length} NFT${mints.length === 1 ? '' : 's'}, ${recipients.length} wallet${recipients.length === 1 ? '' : 's'}).`,
    }
  }
  if (mints.length > OWL_TRANSFER_MAX_SELECT) {
    return { ok: false, error: `Select at most ${OWL_TRANSFER_MAX_SELECT} NFTs per send.` }
  }

  if (params.randomize !== false) {
    for (let i = mints.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = mints[i]!
      mints[i] = mints[j]!
      mints[j] = tmp
    }
  }

  const lines: OwlTransferLine[] = mints.map((m, i) => ({
    mint: m.mint,
    name: m.name,
    tokenAccount: m.tokenAccount,
    image: m.image,
    recipient: recipients[i]!,
  }))
  return { ok: true, lines }
}

/** Parse paste/CSV of wallet addresses (newline, comma, or space separated). */
export function parseRecipientAddresses(raw: string): string[] {
  return raw
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
}
