import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type WalletSplit = {
  address: string
  share: number
}

export type WalletSplitFormRow = {
  address: string
  share: string
}

export const MAX_WALLET_SPLITS = 10

export function defaultWalletSplitFormRows(fallbackAddress = ''): WalletSplitFormRow[] {
  return [{ address: fallbackAddress, share: '100' }]
}

export function walletSplitFormRowsFromLaunch(
  launch: Pick<OwlCenterLaunchPublic, 'creator_wallet' | 'treasury_wallet' | 'royalty_splits' | 'mint_fund_splits'>
): { royalty_splits: WalletSplitFormRow[]; mint_fund_splits: WalletSplitFormRow[] } {
  const creator = launch.creator_wallet?.trim() ?? ''
  const treasury = launch.treasury_wallet?.trim() || creator

  return {
    royalty_splits: walletSplitsToFormRows(launch.royalty_splits, creator),
    mint_fund_splits: walletSplitsToFormRows(launch.mint_fund_splits, treasury),
  }
}

export function walletSplitsToFormRows(raw: WalletSplit[] | null | undefined, fallbackAddress: string): WalletSplitFormRow[] {
  if (raw?.length) {
    return raw.map((row) => ({
      address: row.address,
      share: String(row.share),
    }))
  }
  return defaultWalletSplitFormRows(fallbackAddress)
}

export function sumWalletSplitShares(rows: ReadonlyArray<Pick<WalletSplitFormRow, 'share'>>): number {
  return rows.reduce((sum, row) => {
    const n = Number(row.share)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)
}

export function walletSplitsValid(rows: ReadonlyArray<WalletSplitFormRow>): boolean {
  if (rows.length < 1 || rows.length > MAX_WALLET_SPLITS) return false
  if (Math.abs(sumWalletSplitShares(rows) - 100) > 0.01) return false
  return rows.every((row) => {
    const share = Number(row.share)
    return (
      row.address.trim().length > 0 &&
      Number.isFinite(share) &&
      share > 0 &&
      share <= 100 &&
      !!normalizeSolanaWalletAddress(row.address.trim())
    )
  })
}

export function parseWalletSplitFormRows(
  rows: ReadonlyArray<WalletSplitFormRow>,
  label: string
): WalletSplit[] | { error: string } {
  if (rows.length < 1) return { error: `${label}: add at least one recipient` }
  if (rows.length > MAX_WALLET_SPLITS) return { error: `${label}: too many recipients (max ${MAX_WALLET_SPLITS})` }

  const total = sumWalletSplitShares(rows)
  if (Math.abs(total - 100) > 0.01) {
    return { error: `${label}: shares must add up to 100% (currently ${total.toFixed(1)}%)` }
  }

  const parsed: WalletSplit[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const address = normalizeSolanaWalletAddress(row.address.trim())
    if (!address) return { error: `${label}: invalid wallet address` }

    const share = Number(row.share)
    if (!Number.isFinite(share) || share <= 0 || share > 100) {
      return { error: `${label}: each share must be between 0 and 100` }
    }

    if (seen.has(address)) return { error: `${label}: duplicate wallet address` }
    seen.add(address)

    parsed.push({ address, share: Math.round(share * 100) / 100 })
  }

  return parsed.map((row) => ({
    address: normalizeSolanaWalletAddress(row.address) ?? row.address,
    share: row.share,
  }))
}

export function parseWalletSplitsFromBody(
  body: Record<string, unknown>,
  key: 'royalty_splits' | 'mint_fund_splits',
  label: string
): WalletSplit[] | null | { error: string } {
  const raw = body[key]
  if (raw == null) return null

  if (!Array.isArray(raw)) return { error: `${label}: invalid split list` }

  const rows: WalletSplitFormRow[] = raw.map((item) => {
    if (!item || typeof item !== 'object') return { address: '', share: '' }
    const o = item as Record<string, unknown>
    return {
      address: typeof o.address === 'string' ? o.address : '',
      share: o.share != null ? String(o.share) : '',
    }
  })

  return parseWalletSplitFormRows(rows, label)
}

export function primaryWalletFromSplits(splits: WalletSplit[] | null | undefined): string | null {
  if (!splits?.length) return null
  const sorted = [...splits].sort((a, b) => b.share - a.share)
  return sorted[0]?.address ?? null
}

export function formatWalletSplitsSummary(splits: WalletSplit[] | null | undefined): string {
  if (!splits?.length) return '—'
  return splits.map((row) => `${row.share}% → ${row.address.slice(0, 4)}…${row.address.slice(-4)}`).join(', ')
}

/** Metaplex creators array for Sugar / UMI deploy. */
export function walletSplitsToMetaplexCreators(
  splits: WalletSplit[] | null | undefined,
  fallbackAddress: string
): Array<{ address: string; share: number }> {
  const rows =
    splits?.length && splits.every((s) => s.address && s.share > 0)
      ? splits
      : [{ address: fallbackAddress, share: 100 }]

  return rows.map((row) => ({
    address: row.address,
    share: Math.round(row.share),
  }))
}

export function walletSplitsEqual(a: WalletSplit[] | null | undefined, b: WalletSplit[] | null | undefined): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  return left.every((row, i) => row.address === right[i]?.address && row.share === right[i]?.share)
}

export function walletSplitPayloadFromForm(rows: WalletSplitFormRow[]): WalletSplit[] | undefined {
  const parsed = parseWalletSplitFormRows(rows, 'Wallet split')
  if ('error' in parsed) return undefined
  return parsed
}

export function parseWalletSplitsFromDb(raw: unknown): WalletSplit[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const rows: WalletSplitFormRow[] = raw.map((item) => {
    if (!item || typeof item !== 'object') return { address: '', share: '' }
    const o = item as Record<string, unknown>
    return {
      address: typeof o.address === 'string' ? o.address : '',
      share: o.share != null ? String(o.share) : '',
    }
  })
  const parsed = parseWalletSplitFormRows(rows, 'Wallet split')
  if ('error' in parsed) return null
  return parsed
}
