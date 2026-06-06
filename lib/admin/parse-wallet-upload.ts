import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type ParsedWalletUploadRow = {
  wallet: string
  allowed_mints: number
  community: string | null
  note: string | null
}

export type ParseWalletUploadResult = {
  rows: ParsedWalletUploadRow[]
  errors: string[]
  skipped_duplicates: number
}

type ColumnMap = {
  wallet: number
  allowed?: number
  community?: number
  note?: number
}

const WALLET_HEADER_KEYS = new Set([
  'wallet',
  'address',
  'walletaddress',
  'mintwallet',
  'mintaddress',
  'solana',
  'solanaaddress',
  'publickey',
  'pubkey',
  'owner',
])

const ALLOWED_HEADER_KEYS = new Set([
  'quantity',
  'qty',
  'allowed',
  'allowedmints',
  'spots',
  'allocation',
  'mints',
  'amount',
  'slots',
  'count',
  'mintcount',
])

const COMMUNITY_HEADER_KEYS = new Set([
  'community',
  'collab',
  'role',
  'rolename',
  'source',
  'collection',
  'group',
  'channel',
])

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function splitCsvRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(stripCell(cur))
      cur = ''
    } else {
      cur += ch
    }
  }

  out.push(stripCell(cur))
  return out
}

function splitRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  if (trimmed.includes('\t')) {
    return trimmed.split('\t').map((p) => stripCell(p))
  }

  if (trimmed.includes(',')) {
    return splitCsvRow(trimmed)
  }

  if (trimmed.includes(':') && !normalizeSolanaWalletAddress(trimmed.split(':')[0]?.trim() ?? '')) {
    return trimmed.split(':').map((p) => stripCell(p))
  }

  return [stripCell(trimmed)]
}

function stripCell(raw: string): string {
  const t = raw.trim()
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1).trim()
  }
  return t
}

function parseAllowedMints(raw: string | undefined, defaultAllowed: number): number | null {
  const t = raw?.trim()
  if (!t) return defaultAllowed
  const n = Number(t)
  if (!Number.isInteger(n) || n < 0) return null
  return n
}

function detectColumnMap(headers: string[]): ColumnMap | null {
  const normalized = headers.map(normalizeHeader)
  let wallet = -1
  let allowed: number | undefined
  let community: number | undefined
  let note: number | undefined

  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i] ?? ''
    if (wallet < 0 && WALLET_HEADER_KEYS.has(h)) wallet = i
    if (allowed === undefined && ALLOWED_HEADER_KEYS.has(h)) allowed = i
    if (community === undefined && COMMUNITY_HEADER_KEYS.has(h)) community = i
    if (note === undefined && (h === 'note' || h === 'notes' || h === 'memo' || h === 'discordusername')) note = i
  }

  if (wallet < 0) return null
  return { wallet, allowed, community, note }
}

function looksLikeHeaderRow(parts: string[]): boolean {
  if (parts.length < 2) return false
  const normalized = parts.map(normalizeHeader)
  return normalized.some((h) => WALLET_HEADER_KEYS.has(h) || ALLOWED_HEADER_KEYS.has(h) || COMMUNITY_HEADER_KEYS.has(h))
}

function findWalletInParts(parts: string[], preferredIdx: number): string | null {
  const candidates =
    preferredIdx >= 0 && preferredIdx < parts.length
      ? [preferredIdx, ...parts.map((_, i) => i).filter((i) => i !== preferredIdx)]
      : parts.map((_, i) => i)

  for (const idx of candidates) {
    const raw = parts[idx]?.trim()
    if (!raw) continue
    const wallet = normalizeSolanaWalletAddress(raw)
    if (wallet) return wallet
  }
  return null
}

function parseParts(
  parts: string[],
  lineNo: number,
  defaultAllowed: number,
  columns?: ColumnMap
): { row?: ParsedWalletUploadRow; error?: string } {
  const walletIdx = columns?.wallet ?? 0
  const wallet = findWalletInParts(parts, walletIdx)
  if (!wallet) {
    const walletRaw = parts[walletIdx]?.trim()
    return {
      error: walletRaw
        ? `Line ${lineNo}: invalid wallet "${walletRaw.slice(0, 12)}…"`
        : `Line ${lineNo}: missing wallet`,
    }
  }

  const allowedRaw =
    columns != null
      ? columns.allowed != null
        ? parts[columns.allowed]
        : undefined
      : parts[1]
  const allowed = parseAllowedMints(allowedRaw, defaultAllowed)
  if (allowed === null) {
    return { error: `Line ${lineNo}: invalid allowed_mints "${allowedRaw ?? ''}"` }
  }

  const communityRaw = columns?.community != null ? parts[columns.community] : parts[2]
  const noteRaw = columns?.note != null ? parts[columns.note] : parts[3]
  let community = communityRaw?.trim() || null
  if (community && normalizeSolanaWalletAddress(community)) {
    community = null
  }
  const note = noteRaw?.trim() || null

  return {
    row: {
      wallet,
      allowed_mints: allowed,
      community: community || null,
      note,
    },
  }
}

function parseLine(
  line: string,
  lineNo: number,
  defaultAllowed: number,
  columns?: ColumnMap
): { row?: ParsedWalletUploadRow; error?: string } {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return {}

  const parts = splitRow(trimmed)
  if (!parts.length) return {}

  return parseParts(parts, lineNo, defaultAllowed, columns)
}

function parseJsonWalletUpload(text: string, defaultAllowed: number, maxRows: number): ParseWalletUploadResult | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null

  try {
    const parsed = JSON.parse(trimmed) as unknown
    const items = Array.isArray(parsed) ? parsed : [parsed]
    const errors: string[] = []
    const seen = new Set<string>()
    const rows: ParsedWalletUploadRow[] = []
    let skipped_duplicates = 0

    for (let i = 0; i < items.length; i++) {
      if (rows.length >= maxRows) {
        errors.push(`Stopped at ${maxRows} wallets (max per upload).`)
        break
      }
      const item = items[i]
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const walletRaw =
        rec.wallet ??
        rec.address ??
        rec.mintWallet ??
        rec.mint_wallet ??
        rec.mintAddress ??
        rec.mint_address ??
        rec.publicKey ??
        rec.public_key
      if (typeof walletRaw !== 'string') continue

      const wallet = normalizeSolanaWalletAddress(walletRaw)
      if (!wallet) {
        errors.push(`Row ${i + 1}: invalid wallet "${walletRaw.slice(0, 12)}…"`)
        continue
      }
      if (seen.has(wallet)) {
        skipped_duplicates++
        continue
      }

      const qtyRaw = rec.quantity ?? rec.qty ?? rec.allowed ?? rec.allowed_mints ?? rec.spots ?? rec.allocation
      const allowed = parseAllowedMints(typeof qtyRaw === 'number' ? String(qtyRaw) : String(qtyRaw ?? ''), defaultAllowed)
      if (allowed === null) {
        errors.push(`Row ${i + 1}: invalid allowed_mints`)
        continue
      }

      const communityRaw = rec.community ?? rec.collab ?? rec.role ?? rec.collection ?? rec.source
      seen.add(wallet)
      rows.push({
        wallet,
        allowed_mints: allowed,
        community: typeof communityRaw === 'string' && communityRaw.trim() ? communityRaw.trim() : null,
        note: typeof rec.note === 'string' ? rec.note.trim() || null : null,
      })
    }

    return { rows, errors, skipped_duplicates }
  } catch {
    return null
  }
}

/**
 * Parse pasted CSV / newline list / tab-separated wallets.
 * Supports Atlas3 / allowlist-tool exports with header rows (`wallet`, `mintWallet`, `quantity`, etc.).
 * Formats: `wallet`, `wallet,2`, `wallet,2,pandarianz`, `wallet:2:note`, JSON arrays.
 */
export function parseWalletUploadText(
  text: string,
  options?: { defaultAllowedMints?: number; maxRows?: number }
): ParseWalletUploadResult {
  const defaultAllowed = Math.max(0, Math.floor(options?.defaultAllowedMints ?? 1))
  const maxRows = Math.min(5000, Math.max(1, Math.floor(options?.maxRows ?? 2000)))

  const jsonResult = parseJsonWalletUpload(text, defaultAllowed, maxRows)
  if (jsonResult) return jsonResult

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0 || l.includes('\t'))
  const errors: string[] = []
  const seen = new Set<string>()
  const rows: ParsedWalletUploadRow[] = []
  let skipped_duplicates = 0

  let startIndex = 0
  let columns: ColumnMap | undefined

  if (lines.length > 0) {
    const firstParts = splitRow(lines[0] ?? '')
    if (firstParts.length > 0 && looksLikeHeaderRow(firstParts)) {
      columns = detectColumnMap(firstParts) ?? undefined
      if (columns) startIndex = 1
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    if (rows.length >= maxRows) {
      errors.push(`Stopped at ${maxRows} wallets (max per upload).`)
      break
    }
    const parsed = parseLine(lines[i] ?? '', i + 1, defaultAllowed, columns)
    if (parsed.error) {
      errors.push(parsed.error)
      continue
    }
    if (!parsed.row) continue
    if (seen.has(parsed.row.wallet)) {
      skipped_duplicates++
      continue
    }
    seen.add(parsed.row.wallet)
    rows.push(parsed.row)
  }

  return { rows, errors, skipped_duplicates }
}
