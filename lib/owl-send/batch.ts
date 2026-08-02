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

export type NftScatterEntry = {
  recipient: string
  /** NFT count when provided as `wallet,N`; null = no explicit count. */
  count: number | null
}

const NFT_COUNT_RE = /^[1-9][0-9]*$/
const NUMERIC_RE = /^[0-9]*\.?[0-9]+$/

/**
 * Parse NFT scatter paste:
 * - `wallet` per line (even split when randomize is on)
 * - `wallet,5` or `wallet 5` — that wallet receives exactly that many NFTs
 * Blank lines ignored. Counts must be whole numbers ≥ 1.
 */
export function parseNftScatterEntries(raw: string): NftScatterEntry[] {
  const lines = raw
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    return parseRecipientAddresses(raw).map((recipient) => ({ recipient, count: null }))
  }

  const entries: NftScatterEntry[] = []
  for (const line of lines) {
    const commaParts = line.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    if (commaParts.length === 2 && NUMERIC_RE.test(commaParts[1]!)) {
      const countRaw = commaParts[1]!
      entries.push({
        recipient: commaParts[0]!,
        count: NFT_COUNT_RE.test(countRaw) ? Number(countRaw) : Number.NaN,
      })
      continue
    }
    const spaceParts = line.split(/\s+/).filter(Boolean)
    if (spaceParts.length === 2 && NUMERIC_RE.test(spaceParts[1]!)) {
      const countRaw = spaceParts[1]!
      entries.push({
        recipient: spaceParts[0]!,
        count: NFT_COUNT_RE.test(countRaw) ? Number(countRaw) : Number.NaN,
      })
      continue
    }
    const addrs = parseRecipientAddresses(line)
    for (const recipient of addrs) {
      entries.push({ recipient, count: null })
    }
  }
  return entries
}

/** Expand `wallet,count` entries into a flat recipient list (missing count → 1 when any count is set). */
export function expandNftScatterEntries(entries: NftScatterEntry[]): string[] {
  const weighted = entries.some((e) => e.count != null && Number.isFinite(e.count))
  const out: string[] = []
  for (const e of entries) {
    const n = weighted ? (e.count == null || !Number.isFinite(e.count) ? 1 : e.count) : 1
    for (let i = 0; i < n; i++) out.push(e.recipient)
  }
  return out
}

/** Collapse a 1:1 wallet list into paste text (`wallet,N` when any wallet repeats). */
export function collapseRecipientsToNftScatterPaste(wallets: string[]): string {
  const trimmed = wallets.map((w) => w.trim()).filter(Boolean)
  if (trimmed.length === 0) return ''
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const w of trimmed) {
    if (!counts.has(w)) order.push(w)
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  const anyRepeat = [...counts.values()].some((c) => c > 1)
  if (!anyRepeat) return order.join('\n')
  return order.map((w) => `${w},${counts.get(w)}`).join('\n')
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
}

/**
 * Pair NFTs with recipients for Scatter.
 *
 * - `randomize: false` — exact 1:1 (same count of NFTs and wallets).
 * - `randomize: true` without counts — shuffle NFTs, distribute evenly across unique wallets.
 * - `randomize: true` with `wallet,N` counts — shuffle NFTs, assign exactly N to each wallet
 *   (sum of counts must equal selected NFT count; bare wallets count as 1 when mixed).
 */
export function pairScatterLines(params: {
  mints: Array<{ mint: string; name?: string | null; tokenAccount?: string | null; image?: string | null }>
  recipients?: string[]
  entries?: NftScatterEntry[]
  randomize?: boolean
}): { ok: true; lines: OwlSendLine[] } | { ok: false; error: string } {
  const entries: NftScatterEntry[] =
    params.entries ??
    (params.recipients ?? []).map((r) => ({ recipient: r.trim(), count: null })).filter((e) => e.recipient)

  const mints = [...params.mints]
  if (mints.length === 0) return { ok: false, error: 'Select at least one NFT.' }
  if (entries.length === 0) return { ok: false, error: 'Add at least one recipient wallet.' }
  if (mints.length > OWL_SEND_MAX_SELECT) {
    return { ok: false, error: `Select at most ${OWL_SEND_MAX_SELECT} NFTs per send.` }
  }

  for (const e of entries) {
    if (e.count != null && !Number.isFinite(e.count)) {
      return {
        ok: false,
        error: `NFT counts must be whole numbers (e.g. ${e.recipient.slice(0, 4)}…,5).`,
      }
    }
    if (e.count != null && (!Number.isInteger(e.count) || e.count < 1)) {
      return {
        ok: false,
        error: `NFT counts must be whole numbers ≥ 1 (e.g. wallet,5).`,
      }
    }
  }

  const randomize = params.randomize !== false
  const hasExplicitCounts = entries.some((e) => e.count != null)

  if (!randomize) {
    const recipientsRaw = hasExplicitCounts
      ? expandNftScatterEntries(entries)
      : entries.map((e) => e.recipient)
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

  // Weighted allotments: wallet,5 / wallet,1 / …
  if (hasExplicitCounts) {
    const allotments: Array<{ recipient: string; count: number }> = []
    for (const e of entries) {
      const count = e.count == null ? 1 : e.count
      allotments.push({ recipient: e.recipient, count })
    }
    const total = allotments.reduce((sum, a) => sum + a.count, 0)
    if (total !== mints.length) {
      return {
        ok: false,
        error: `Counts sum to ${total} but ${mints.length} NFT${mints.length === 1 ? '' : 's'} selected — adjust wallet,N lines or selection so they match.`,
      }
    }
    if (allotments.length > mints.length) {
      return {
        ok: false,
        error: `Too many wallets (${allotments.length}) for ${mints.length} NFT${mints.length === 1 ? '' : 's'} — remove extras or select more NFTs.`,
      }
    }

    shuffleInPlace(mints)
    const slots: string[] = []
    for (const a of allotments) {
      for (let i = 0; i < a.count; i++) slots.push(a.recipient)
    }
    const lines: OwlSendLine[] = mints.map((m, i) => ({
      mint: m.mint,
      name: m.name,
      tokenAccount: m.tokenAccount,
      image: m.image,
      recipient: slots[i]!,
    }))
    return { ok: true, lines }
  }

  // Even distribute across unique wallets (preserve first-seen order).
  const uniqueRecipients: string[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.recipient)) continue
    seen.add(e.recipient)
    uniqueRecipients.push(e.recipient)
  }

  if (uniqueRecipients.length > mints.length) {
    return {
      ok: false,
      error: `Too many wallets (${uniqueRecipients.length}) for ${mints.length} NFT${mints.length === 1 ? '' : 's'} — remove extras or select more NFTs.`,
    }
  }

  shuffleInPlace(mints)
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
