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

function parseAllowedMints(raw: string | undefined, defaultAllowed: number): number | null {
  const t = raw?.trim()
  if (!t) return defaultAllowed
  const n = Number(t)
  if (!Number.isInteger(n) || n < 0) return null
  return n
}

function parseLine(
  line: string,
  lineNo: number,
  defaultAllowed: number
): { row?: ParsedWalletUploadRow; error?: string } {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return {}

  let parts: string[]
  if (trimmed.includes(',')) {
    parts = trimmed.split(',').map((p) => p.trim())
  } else if (trimmed.includes(':')) {
    parts = trimmed.split(':').map((p) => p.trim())
  } else if (trimmed.includes('\t')) {
    parts = trimmed.split('\t').map((p) => p.trim())
  } else {
    parts = [trimmed]
  }

  const walletRaw = parts[0]
  if (!walletRaw) {
    return { error: `Line ${lineNo}: missing wallet` }
  }

  const wallet = normalizeSolanaWalletAddress(walletRaw)
  if (!wallet) {
    return { error: `Line ${lineNo}: invalid wallet "${walletRaw.slice(0, 12)}…"` }
  }

  const allowed = parseAllowedMints(parts[1], defaultAllowed)
  if (allowed === null) {
    return { error: `Line ${lineNo}: invalid allowed_mints "${parts[1]}"` }
  }

  const community = parts[2]?.trim() || null
  const note = parts[3]?.trim() || null

  return {
    row: {
      wallet,
      allowed_mints: allowed,
      community: community || null,
      note,
    },
  }
}

/**
 * Parse pasted CSV / newline list / tab-separated wallets.
 * Formats: `wallet`, `wallet,2`, `wallet,2,pandarianz`, `wallet:2:note`
 */
export function parseWalletUploadText(
  text: string,
  options?: { defaultAllowedMints?: number; maxRows?: number }
): ParseWalletUploadResult {
  const defaultAllowed = Math.max(0, Math.floor(options?.defaultAllowedMints ?? 1))
  const maxRows = Math.min(5000, Math.max(1, Math.floor(options?.maxRows ?? 2000)))

  const lines = text.split(/\r?\n/)
  const errors: string[] = []
  const seen = new Set<string>()
  const rows: ParsedWalletUploadRow[] = []
  let skipped_duplicates = 0

  for (let i = 0; i < lines.length; i++) {
    if (rows.length >= maxRows) {
      errors.push(`Stopped at ${maxRows} wallets (max per upload).`)
      break
    }
    const parsed = parseLine(lines[i] ?? '', i + 1, defaultAllowed)
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
