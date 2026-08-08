/**
 * OwlSend airdrop CSV — client-side lint before Scatter send.
 *
 * Keep this a simple lint (ARC): check the file is a proper CSV with valid
 * wallets before anything runs. No server upload, no campaign engine.
 *
 * Expected shapes (see /owl-send/airdrop.csv):
 * - wallet
 * - wallet,count   (NFT scatter allotments)
 * - wallet,amount  (token scatter per-wallet amounts)
 */

import { isValidSolanaPubkey } from '@/lib/solana/validate-pubkey'
import { OWL_SEND_MAX_SELECT } from '@/lib/owl-send/constants'

export const OWL_SEND_AIRDROP_CSV_FILENAME = 'airdrop.csv'
export const OWL_SEND_AIRDROP_CSV_HREF = '/owl-send/airdrop.csv'

export type OwlSendCsvKind = 'nft' | 'token'

export type OwlSendCsvEntry = {
  recipient: string
  /** NFT count when present; null = no explicit count. */
  count: number | null
  /** Token UI amount when present; null = use default amount. */
  amountUi: string | null
  sourceRow: number
}

export type OwlSendCsvRowError = {
  row: number
  message: string
  raw?: string
}

export type OwlSendCsvParseResult = {
  ok: boolean
  /** Hard failure — do not apply (unreadable / no wallet column / zero valid). */
  error: string | null
  entries: OwlSendCsvEntry[]
  rowErrors: OwlSendCsvRowError[]
  warnings: string[]
  /** Detected or selected wallet column index (0-based). */
  walletColumnIndex: number | null
  headers: string[] | null
  truncated: boolean
}

const WALLET_HEADER_RE =
  /^(wallet|address|recipient|pubkey|public[_ ]?key|wallet[_ ]?address|solana[_ ]?address|owner)$/i
const COUNT_HEADER_RE = /^(count|qty|quantity|n|nfts?|nft[_ ]?count)$/i
const AMOUNT_HEADER_RE = /^(amount|amt|value|tokens?|token[_ ]?amount)$/i
const COUNT_VALUE_RE = /^[1-9][0-9]*$/
const AMOUNT_VALUE_RE = /^[0-9]*\.?[0-9]+$/

/** Strip UTF-8 BOM and normalize newlines. */
export function normalizeCsvText(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Minimal CSV row parser — handles commas, double-quoted fields, and "" escapes.
 * Does not support embedded newlines inside quoted fields (airdrop lists rarely need them).
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
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
      continue
    }
    if (ch === ',' || ch === ';') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

export function splitCsvRows(raw: string): string[] {
  return normalizeCsvText(raw)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function looksLikeHeaderCell(cell: string): boolean {
  const t = cell.trim()
  if (!t) return false
  if (WALLET_HEADER_RE.test(t) || COUNT_HEADER_RE.test(t) || AMOUNT_HEADER_RE.test(t)) return true
  // Non-base58 label-ish headers (letters + underscore/space)
  return /^[a-z][a-z0-9 _-]*$/i.test(t) && !isValidSolanaPubkey(t)
}

function detectWalletColumn(headers: string[]): number | null {
  for (let i = 0; i < headers.length; i++) {
    if (WALLET_HEADER_RE.test(headers[i]!)) return i
  }
  return null
}

function detectCountColumn(headers: string[]): number | null {
  for (let i = 0; i < headers.length; i++) {
    if (COUNT_HEADER_RE.test(headers[i]!)) return i
  }
  return null
}

function detectAmountColumn(headers: string[]): number | null {
  for (let i = 0; i < headers.length; i++) {
    if (AMOUNT_HEADER_RE.test(headers[i]!)) return i
  }
  return null
}

export type ParseOwlSendCsvParams = {
  raw: string
  kind: OwlSendCsvKind
  /** Override auto-detected wallet column (0-based). */
  walletColumnIndex?: number | null
  maxEntries?: number
}

/**
 * Parse + lint an airdrop CSV. Safe to call before any send / Apply.
 * Returns ok=false on hard failures; ok=true with rowErrors for soft skips.
 */
export function parseOwlSendCsv(params: ParseOwlSendCsvParams): OwlSendCsvParseResult {
  const max = params.maxEntries ?? OWL_SEND_MAX_SELECT
  const lines = splitCsvRows(params.raw)
  if (lines.length === 0) {
    return {
      ok: false,
      error: 'CSV is empty. Download airdrop.csv for the expected format.',
      entries: [],
      rowErrors: [],
      warnings: [],
      walletColumnIndex: null,
      headers: null,
      truncated: false,
    }
  }

  const firstCells = parseCsvLine(lines[0]!)
  const hasHeader = firstCells.some(looksLikeHeaderCell) && !firstCells.some((c) => isValidSolanaPubkey(c))

  let headers: string[] | null = null
  let dataLines = lines
  let walletCol: number | null =
    typeof params.walletColumnIndex === 'number' ? params.walletColumnIndex : null
  let countCol: number | null = null
  let amountCol: number | null = null

  if (hasHeader) {
    headers = firstCells.map((h) => h.trim())
    dataLines = lines.slice(1)
    if (walletCol == null) walletCol = detectWalletColumn(headers)
    countCol = detectCountColumn(headers)
    amountCol = detectAmountColumn(headers)
    if (walletCol == null) {
      // Single unlabeled column named oddly — fall back to first column if only one.
      if (headers.length === 1) walletCol = 0
    }
  } else {
    walletCol = walletCol ?? 0
  }

  if (walletCol == null || walletCol < 0) {
    return {
      ok: false,
      error:
        'Could not find a wallet column. Use header "wallet" (or address / recipient), or a single-column list.',
      entries: [],
      rowErrors: [],
      warnings: [],
      walletColumnIndex: null,
      headers,
      truncated: false,
    }
  }

  if (dataLines.length === 0) {
    return {
      ok: false,
      error: 'CSV has a header but no data rows.',
      entries: [],
      rowErrors: [],
      warnings: [],
      walletColumnIndex: walletCol,
      headers,
      truncated: false,
    }
  }

  const entries: OwlSendCsvEntry[] = []
  const rowErrors: OwlSendCsvRowError[] = []
  const warnings: string[] = []
  const headerOffset = hasHeader ? 1 : 0

  for (let i = 0; i < dataLines.length; i++) {
    const rowNum = i + 1 + headerOffset
    const rawLine = dataLines[i]!
    const cells = parseCsvLine(rawLine)
    const recipientRaw = (cells[walletCol] ?? '').trim()
    if (!recipientRaw) {
      rowErrors.push({ row: rowNum, message: 'Empty wallet cell', raw: rawLine })
      continue
    }
    if (!isValidSolanaPubkey(recipientRaw)) {
      rowErrors.push({
        row: rowNum,
        message: `Invalid Solana address: ${recipientRaw.slice(0, 12)}${recipientRaw.length > 12 ? '…' : ''}`,
        raw: rawLine,
      })
      continue
    }

    let count: number | null = null
    let amountUi: string | null = null

    if (params.kind === 'nft' && countCol != null && cells[countCol] != null && cells[countCol]!.trim() !== '') {
      const c = cells[countCol]!.trim()
      if (!COUNT_VALUE_RE.test(c)) {
        rowErrors.push({ row: rowNum, message: `Invalid NFT count "${c}" (use whole numbers ≥ 1)`, raw: rawLine })
        continue
      }
      count = Number(c)
    }

    if (params.kind === 'token' && amountCol != null && cells[amountCol] != null && cells[amountCol]!.trim() !== '') {
      const a = cells[amountCol]!.trim()
      if (!AMOUNT_VALUE_RE.test(a) || !(Number(a) > 0)) {
        rowErrors.push({ row: rowNum, message: `Invalid amount "${a}"`, raw: rawLine })
        continue
      }
      amountUi = a
    }

    // Headerless 2-col: interpret second cell by kind when present.
    if (!hasHeader && cells.length >= 2 && cells[1]!.trim() !== '') {
      const second = cells[1]!.trim()
      if (params.kind === 'nft' && count == null) {
        if (!COUNT_VALUE_RE.test(second)) {
          rowErrors.push({
            row: rowNum,
            message: `Invalid NFT count "${second}" (use whole numbers ≥ 1)`,
            raw: rawLine,
          })
          continue
        }
        count = Number(second)
      }
      if (params.kind === 'token' && amountUi == null) {
        if (!AMOUNT_VALUE_RE.test(second) || !(Number(second) > 0)) {
          rowErrors.push({ row: rowNum, message: `Invalid amount "${second}"`, raw: rawLine })
          continue
        }
        amountUi = second
      }
    }

    entries.push({ recipient: recipientRaw, count, amountUi, sourceRow: rowNum })
  }

  let truncated = false
  let kept = entries
  if (entries.length > max) {
    truncated = true
    kept = entries.slice(0, max)
    warnings.push(
      `CSV has ${entries.length} valid wallets; OwlSend accepts ${max} per session. First ${max} applied — send again with the remainder.`
    )
  }

  if (kept.length === 0) {
    return {
      ok: false,
      error:
        rowErrors.length > 0
          ? `No valid wallets found (${rowErrors.length} row${rowErrors.length === 1 ? '' : 's'} failed validation).`
          : 'No valid wallets found.',
      entries: [],
      rowErrors,
      warnings,
      walletColumnIndex: walletCol,
      headers,
      truncated: false,
    }
  }

  if (rowErrors.length > 0) {
    warnings.push(
      `Skipped ${rowErrors.length} invalid row${rowErrors.length === 1 ? '' : 's'} — review before send.`
    )
  }

  return {
    ok: true,
    error: null,
    entries: kept,
    rowErrors,
    warnings,
    walletColumnIndex: walletCol,
    headers,
    truncated,
  }
}

/** Alias — CSV check is intentionally a simple lint before send. */
export const lintOwlSendCsv = parseOwlSendCsv

/** Turn validated entries into NFT Scatter paste text. */
export function owlSendCsvEntriesToNftPaste(entries: OwlSendCsvEntry[]): string {
  const hasCounts = entries.some((e) => e.count != null && Number.isFinite(e.count))
  return entries
    .map((e) => (hasCounts ? `${e.recipient},${e.count == null ? 1 : e.count}` : e.recipient))
    .join('\n')
}

/** Turn validated entries into token Scatter paste text. */
export function owlSendCsvEntriesToTokenPaste(entries: OwlSendCsvEntry[]): string {
  return entries
    .map((e) => (e.amountUi != null && e.amountUi.trim() !== '' ? `${e.recipient},${e.amountUi}` : e.recipient))
    .join('\n')
}

/** True when filename/MIME looks like a CSV before reading contents. */
export function isLikelyCsvFile(file: { name?: string; type?: string }): boolean {
  const name = (file.name ?? '').toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) return true
  const type = (file.type ?? '').toLowerCase()
  return (
    type === 'text/csv' ||
    type === 'text/plain' ||
    type === 'application/vnd.ms-excel' ||
    type === 'application/csv'
  )
}

export const OWL_SEND_CSV_FORMAT_HINT_NFT = `Header optional. Use:
wallet
or
wallet,count
Example file: airdrop.csv`

export const OWL_SEND_CSV_FORMAT_HINT_TOKEN = `Header optional. Use:
wallet
or
wallet,amount
Example file: airdrop.csv`
