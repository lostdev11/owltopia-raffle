import { OWL_SEND_MAX_PER_TX, OWL_SEND_MAX_SELECT } from '@/lib/owl-send/constants'

export type OwlSendLine = {
  mint: string
  recipient: string
  /** Optional display name */
  name?: string | null
  tokenAccount?: string | null
  image?: string | null
}

/** Cap selection to product max (20). */
export function capOwlSendSelection<T>(items: T[]): T[] {
  return items.slice(0, OWL_SEND_MAX_SELECT)
}

/** Split lines into wallet-approval batches of ≤5. */
export function chunkOwlSendBatches<T>(
  items: T[],
  maxPerTx: number = OWL_SEND_MAX_PER_TX
): T[][] {
  const chunks: T[][] = []
  const size = Math.max(1, Math.floor(maxPerTx))
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Pair NFTs with recipients for Scatter.
 *
 * - `randomize: false` — exact 1:1 (same count of NFTs and wallets).
 * - `randomize: true` — shuffle NFTs, then either 1:1 if counts match, or
 *   distribute evenly across fewer unique wallets (e.g. 20 NFTs → 4 wallets).
 */
export function pairScatterLines(params: {
  mints: Array<{ mint: string; name?: string | null; tokenAccount?: string | null; image?: string | null }>
  recipients: string[]
  randomize?: boolean
}): { ok: true; lines: OwlSendLine[] } | { ok: false; error: string } {
  const recipientsRaw = params.recipients.map((r) => r.trim()).filter(Boolean)
  const mints = [...params.mints]
  if (mints.length === 0) return { ok: false, error: 'Select at least one NFT.' }
  if (recipientsRaw.length === 0) return { ok: false, error: 'Add at least one recipient wallet.' }
  if (mints.length > OWL_SEND_MAX_SELECT) {
    return { ok: false, error: `Select at most ${OWL_SEND_MAX_SELECT} NFTs per send.` }
  }

  const randomize = params.randomize !== false

  // Dedupe wallets for distribute mode (preserve first-seen order).
  const uniqueRecipients: string[] = []
  const seen = new Set<string>()
  for (const r of recipientsRaw) {
    if (seen.has(r)) continue
    seen.add(r)
    uniqueRecipients.push(r)
  }

  if (!randomize) {
    if (recipientsRaw.length !== mints.length) {
      return {
        ok: false,
        error: `Scatter needs the same number of NFTs and wallets (${mints.length} NFT${mints.length === 1 ? '' : 's'}, ${recipientsRaw.length} wallet${recipientsRaw.length === 1 ? '' : 's'}). Turn on randomize to split NFTs across fewer wallets.`,
      }
    }
    const lines: OwlSendLine[] = mints.map((m, i) => ({
      mint: m.mint,
      name: m.name,
      tokenAccount: m.tokenAccount,
      image: m.image,
      recipient: recipientsRaw[i]!,
    }))
    return { ok: true, lines }
  }

  if (uniqueRecipients.length > mints.length) {
    return {
      ok: false,
      error: `Too many wallets (${uniqueRecipients.length}) for ${mints.length} NFT${mints.length === 1 ? '' : 's'} — remove extras or select more NFTs.`,
    }
  }

  // Shuffle NFT order, then assign round-robin across unique wallets.
  for (let i = mints.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = mints[i]!
    mints[i] = mints[j]!
    mints[j] = tmp
  }

  const lines: OwlSendLine[] = mints.map((m, i) => ({
    mint: m.mint,
    name: m.name,
    tokenAccount: m.tokenAccount,
    image: m.image,
    recipient: uniqueRecipients[i % uniqueRecipients.length]!,
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

export type TokenScatterEntry = {
  recipient: string
  /** UI amount string when provided as `wallet,amount`; null = use default amount. */
  amountUi: string | null
}

const AMOUNT_RE = /^[0-9]*\.?[0-9]+$/

/**
 * Parse token scatter paste:
 * - `wallet` per line (uses default amount)
 * - `wallet,amount` or `wallet amount` per line
 * Blank lines ignored. Comma-separated wallets without amounts still work when each
 * token is on its own line; mixed `wallet,amount` lines take precedence per line.
 */
export function parseTokenScatterEntries(raw: string): TokenScatterEntry[] {
  const lines = raw
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    return parseRecipientAddresses(raw).map((recipient) => ({ recipient, amountUi: null }))
  }

  const entries: TokenScatterEntry[] = []
  for (const line of lines) {
    const commaParts = line.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    if (commaParts.length === 2 && AMOUNT_RE.test(commaParts[1]!)) {
      entries.push({ recipient: commaParts[0]!, amountUi: commaParts[1]! })
      continue
    }
    const spaceParts = line.split(/\s+/).filter(Boolean)
    if (spaceParts.length === 2 && AMOUNT_RE.test(spaceParts[1]!)) {
      entries.push({ recipient: spaceParts[0]!, amountUi: spaceParts[1]! })
      continue
    }
    // Whole line is one address (or multiple wallets without amounts)
    const addrs = parseRecipientAddresses(line)
    for (const recipient of addrs) {
      entries.push({ recipient, amountUi: null })
    }
  }
  return entries
}

export type OwlSendTokenScatterLine = {
  mint: string
  tokenAccount: string
  amountRaw: bigint
  decimals: number
  symbol?: string
  recipient: string
}

/** Build per-recipient token lines from scatter entries + a selected fungible. */
export function buildTokenScatterLines(params: {
  mint: string
  tokenAccount: string
  decimals: number
  symbol?: string
  defaultAmountUi: string
  entries: TokenScatterEntry[]
  maxSelect?: number
}): { ok: true; lines: OwlSendTokenScatterLine[] } | { ok: false; error: string } {
  const max = params.maxSelect ?? OWL_SEND_MAX_SELECT
  if (params.entries.length < 1) {
    return { ok: false, error: 'Paste at least one recipient wallet.' }
  }
  if (params.entries.length > max) {
    return { ok: false, error: `Scatter at most ${max} wallets per send.` }
  }

  const lines: OwlSendTokenScatterLine[] = []
  for (const entry of params.entries) {
    const uiStr = (entry.amountUi ?? params.defaultAmountUi).trim()
    const ui = Number(uiStr)
    if (!Number.isFinite(ui) || ui <= 0) {
      return {
        ok: false,
        error: entry.amountUi
          ? `Invalid amount for ${entry.recipient.slice(0, 4)}…`
          : 'Enter a default amount greater than 0 (or wallet,amount per line).',
      }
    }
    const amountRaw = BigInt(Math.round(ui * 10 ** params.decimals))
    lines.push({
      mint: params.mint,
      tokenAccount: params.tokenAccount,
      amountRaw,
      decimals: params.decimals,
      symbol: params.symbol,
      recipient: entry.recipient,
    })
  }
  return { ok: true, lines }
}
