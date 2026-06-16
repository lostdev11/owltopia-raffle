import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { DEFAULT_PRESALE_OVERAGE_SUPPLY } from '@/lib/owl-center/launch-presale'
import { datetimeLocalToIso } from '@/lib/owl-center/phase-schedule'
import {
  DEFAULT_SELLER_FEE_BASIS_POINTS,
  basisPointsToPercent,
  launchSellerFeeBasisPoints,
  percentToBasisPoints,
} from '@/lib/owl-center/royalty'
import {
  defaultWalletSplitFormRows,
  parseWalletSplitFormRows,
  parseWalletSplitsFromBody,
  primaryWalletFromSplits,
  walletSplitFormRowsFromLaunch,
  type WalletSplit,
  type WalletSplitFormRow,
} from '@/lib/owl-center/wallet-splits'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type MintDetailsFormValues = {
  total_supply: string
  public_price: string
  wl_price: string
  currency: 'SOL' | 'USDC'
  wallet_mint_limit: string
  launch_date: string
  public_start: string
  presale_enabled: boolean
  presale_supply: string
  presale_overage_supply: string
  presale_start: string
  wl_enabled: boolean
  wl_supply: string
  wl_start: string
  /** Secondary royalty percent (0–100) — locked after Candy Machine deploy. */
  royalty_percent: string
  royalty_splits: WalletSplitFormRow[]
  mint_fund_splits: WalletSplitFormRow[]
}

export type ParsedMintDetailsConfig = {
  total_supply: number
  public_price: number
  wl_price: number | null
  currency: 'SOL' | 'USDC'
  wallet_mint_limit: number
  launch_deadline_at: string | null
  phase_schedule: Record<string, string>
  creator_presale_enabled: boolean
  creator_wl_enabled: boolean
  presale_supply: number
  presale_overage_supply: number
  wl_supply: number
  public_supply: number
  airdrop_supply: number
  public_price_usdc: number | null
  wl_price_usdc: number | null
  creator_mint_price: number
  creator_mint_currency: 'SOL' | 'USDC'
  seller_fee_basis_points: number
  royalty_splits: WalletSplit[] | null
  mint_fund_splits: WalletSplit[] | null
  treasury_wallet: string | null
}

function pickNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function pickInt(v: unknown, fallback: number, min = 0, max = 50_000): number {
  const n = Math.floor(pickNum(v, fallback))
  return Math.min(max, Math.max(min, n))
}

function parseScheduleEntry(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  return datetimeLocalToIso(v.trim()) ?? (Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : null)
}

/** Build mint config from launch submission or admin PATCH body. */
export function parseMintDetailsConfig(body: Record<string, unknown>): ParsedMintDetailsConfig | { error: string } {
  const total_supply = pickInt(body.total_supply, 0, 1, 1_000_000)
  if (total_supply < 1) return { error: 'Invalid total supply' }

  const currency = body.currency === 'USDC' ? 'USDC' : 'SOL'
  const public_price = pickNum(body.mint_price ?? body.public_price ?? body.creator_mint_price, 0)
  if (public_price < 0) return { error: 'Invalid public mint price' }

  const wl_price_raw = body.wl_price ?? body.wl_price_usdc
  const wl_price =
    wl_price_raw != null && wl_price_raw !== '' && Number.isFinite(Number(wl_price_raw))
      ? Math.max(0, Number(wl_price_raw))
      : null

  const wallet_mint_limit = pickInt(body.wallet_mint_limit, 5, 1, 50)

  const presale_enabled = Boolean(body.presale_enabled ?? body.creator_presale_enabled)
  const wl_enabled = Boolean(body.wl_enabled ?? body.creator_wl_enabled)

  const presale_supply = presale_enabled
    ? pickInt(body.presale_supply, Math.min(total_supply, Math.max(1, Math.floor(total_supply * 0.9))), 0, total_supply)
    : 0

  const presale_overage_supply = presale_enabled
    ? pickInt(body.presale_overage_supply, DEFAULT_PRESALE_OVERAGE_SUPPLY, 0, 500)
    : 0

  const wl_supply = wl_enabled
    ? pickInt(body.wl_supply, Math.min(total_supply - presale_supply, Math.max(0, Math.floor(total_supply * 0.1))), 0, total_supply)
    : 0

  const public_supply_explicit =
    body.public_supply != null && body.public_supply !== ''
      ? pickInt(body.public_supply, total_supply, 0, total_supply)
      : null

  let public_supply =
    public_supply_explicit ?? (presale_enabled ? Math.max(0, total_supply - presale_supply - wl_supply) : total_supply - wl_supply)

  if (presale_supply + wl_supply + public_supply > total_supply) {
    return { error: 'Phase supplies (presale + WL + public) cannot exceed total supply' }
  }

  if (presale_supply + wl_supply + public_supply < total_supply) {
    public_supply += total_supply - (presale_supply + wl_supply + public_supply)
  }

  let launch_deadline_at: string | null = null
  if (typeof body.launch_date === 'string' && body.launch_date.trim()) {
    launch_deadline_at = parseScheduleEntry(body.launch_date)
  } else if (typeof body.launch_deadline_at === 'string' && body.launch_deadline_at.trim()) {
    launch_deadline_at = parseScheduleEntry(body.launch_deadline_at)
  }

  const phase_schedule: Record<string, string> = {}
  const rawSchedule = body.phase_schedule
  if (rawSchedule && typeof rawSchedule === 'object' && !Array.isArray(rawSchedule)) {
    for (const [k, v] of Object.entries(rawSchedule as Record<string, unknown>)) {
      const iso = parseScheduleEntry(v)
      if (iso) phase_schedule[k] = iso
    }
  }

  const presale_start = parseScheduleEntry(body.presale_start)
  const wl_start = parseScheduleEntry(body.wl_start)
  const public_start = parseScheduleEntry(body.public_start ?? body.public_phase_start)

  if (presale_enabled && presale_start) phase_schedule.PRESALE = presale_start
  if (wl_enabled && wl_start) phase_schedule.WHITELIST = wl_start
  if (public_start) phase_schedule.PUBLIC = public_start
  else if (launch_deadline_at && !phase_schedule.PUBLIC) phase_schedule.PUBLIC = launch_deadline_at

  if (launch_deadline_at && !phase_schedule.AIRDROP) phase_schedule.AIRDROP = launch_deadline_at

  const public_price_usdc = currency === 'USDC' ? public_price : null
  const wl_price_usdc = wl_enabled && wl_price != null ? wl_price : null

  let seller_fee_basis_points = DEFAULT_SELLER_FEE_BASIS_POINTS
  if (body.seller_fee_basis_points != null && body.seller_fee_basis_points !== '') {
    seller_fee_basis_points = Math.min(
      10_000,
      Math.max(0, Math.floor(Number(body.seller_fee_basis_points)))
    )
    if (!Number.isFinite(seller_fee_basis_points)) {
      return { error: 'Invalid royalty basis points' }
    }
  } else if (body.royalty_percent != null && body.royalty_percent !== '') {
    const pct = Number(body.royalty_percent)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { error: 'Royalty must be between 0% and 100%' }
    }
    seller_fee_basis_points = percentToBasisPoints(pct)
  }

  const royaltySplits = parseWalletSplitsFromBody(body, 'royalty_splits', 'Secondary royalty split')
  if (royaltySplits && 'error' in royaltySplits) return { error: royaltySplits.error }

  const mintFundSplits = parseWalletSplitsFromBody(body, 'mint_fund_splits', 'Mint funds split')
  if (mintFundSplits && 'error' in mintFundSplits) return { error: mintFundSplits.error }

  let treasury_wallet: string | null = null
  if (typeof body.treasury_wallet === 'string' && body.treasury_wallet.trim()) {
    treasury_wallet = normalizeSolanaWalletAddress(body.treasury_wallet.trim())
    if (!treasury_wallet) return { error: 'Invalid treasury wallet' }
  } else if (mintFundSplits?.length) {
    treasury_wallet = primaryWalletFromSplits(mintFundSplits)
  }

  return {
    total_supply,
    public_price,
    wl_price,
    currency,
    wallet_mint_limit,
    launch_deadline_at,
    phase_schedule,
    creator_presale_enabled: presale_enabled,
    creator_wl_enabled: wl_enabled,
    presale_supply,
    presale_overage_supply,
    wl_supply,
    public_supply,
    airdrop_supply: 0,
    public_price_usdc,
    wl_price_usdc,
    creator_mint_price: public_price,
    creator_mint_currency: currency,
    seller_fee_basis_points,
    royalty_splits: royaltySplits,
    mint_fund_splits: mintFundSplits,
    treasury_wallet,
  }
}

export function mintDetailsFormFromLaunch(launch: OwlCenterLaunchPublic): MintDetailsFormValues {
  const currency = launch.creator_mint_currency === 'USDC' ? 'USDC' : 'SOL'
  const publicPrice =
    currency === 'USDC'
      ? String(launch.public_price_usdc ?? launch.creator_mint_price ?? 0)
      : String(launch.creator_mint_price ?? 0)

  const splitForms = walletSplitFormRowsFromLaunch(launch)

  return {
    total_supply: String(launch.total_supply),
    public_price: publicPrice,
    wl_price: launch.wl_price_usdc != null ? String(launch.wl_price_usdc) : '',
    currency,
    wallet_mint_limit: String(launch.wallet_mint_limit),
    launch_date: launch.launch_deadline_at ? isoToDatetimeLocalShort(launch.launch_deadline_at) : '',
    public_start: launch.phase_schedule?.PUBLIC ? isoToDatetimeLocalShort(launch.phase_schedule.PUBLIC) : '',
    presale_enabled: launch.creator_presale_enabled || launch.presale_supply > 0,
    presale_supply: String(launch.presale_supply || ''),
    presale_overage_supply: String(launch.presale_overage_supply || ''),
    presale_start: launch.phase_schedule?.PRESALE ? isoToDatetimeLocalShort(launch.phase_schedule.PRESALE) : '',
    wl_enabled: launch.creator_wl_enabled || launch.wl_supply > 0,
    wl_supply: String(launch.wl_supply || ''),
    wl_start: launch.phase_schedule?.WHITELIST ? isoToDatetimeLocalShort(launch.phase_schedule.WHITELIST) : '',
    royalty_percent: String(basisPointsToPercent(launchSellerFeeBasisPoints(launch))),
    royalty_splits: splitForms.royalty_splits,
    mint_fund_splits: splitForms.mint_fund_splits,
  }
}

function isoToDatetimeLocalShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function mintDetailsPayloadFromForm(values: MintDetailsFormValues): Record<string, unknown> {
  const royaltySplits = parseWalletSplitFormRows(values.royalty_splits, 'Secondary royalty split')
  const mintFundSplits = parseWalletSplitFormRows(values.mint_fund_splits, 'Mint funds split')

  return {
    total_supply: Number(values.total_supply),
    mint_price: Number(values.public_price),
    public_price: Number(values.public_price),
    wl_price: values.wl_price.trim() ? Number(values.wl_price) : null,
    currency: values.currency,
    wallet_mint_limit: Number(values.wallet_mint_limit),
    launch_date: values.launch_date.trim() || null,
    presale_enabled: values.presale_enabled,
    presale_supply: values.presale_supply.trim() ? Number(values.presale_supply) : undefined,
    presale_overage_supply: values.presale_overage_supply.trim() ? Number(values.presale_overage_supply) : undefined,
    wl_enabled: values.wl_enabled,
    wl_supply: values.wl_supply.trim() ? Number(values.wl_supply) : undefined,
    phase_schedule: {
      ...(values.launch_date.trim() ? { AIRDROP: values.launch_date.trim() } : {}),
      ...(values.presale_enabled && values.presale_start.trim() ? { PRESALE: values.presale_start.trim() } : {}),
      ...(values.wl_enabled && values.wl_start.trim() ? { WHITELIST: values.wl_start.trim() } : {}),
      ...(values.public_start.trim() ? { PUBLIC: values.public_start.trim() } : {}),
    },
    presale_start: values.presale_start.trim() || null,
    wl_start: values.wl_start.trim() || null,
    public_start: values.public_start.trim() || null,
    royalty_percent: values.royalty_percent.trim() ? Number(values.royalty_percent) : undefined,
    royalty_splits: 'error' in royaltySplits ? values.royalty_splits : royaltySplits,
    mint_fund_splits: 'error' in mintFundSplits ? values.mint_fund_splits : mintFundSplits,
    treasury_wallet:
      'error' in mintFundSplits ? undefined : primaryWalletFromSplits(mintFundSplits),
  }
}

export function defaultMintDetailsFormValues(partial?: Partial<MintDetailsFormValues>): MintDetailsFormValues {
  const creator = partial?.royalty_splits?.[0]?.address ?? ''
  const treasury = partial?.mint_fund_splits?.[0]?.address ?? creator

  return {
    total_supply: '1000',
    public_price: '1',
    wl_price: '',
    currency: 'SOL',
    wallet_mint_limit: '5',
    launch_date: '',
    public_start: '',
    presale_enabled: false,
    presale_supply: '',
    presale_overage_supply: '13',
    presale_start: '',
    wl_enabled: false,
    wl_supply: '',
    wl_start: '',
    royalty_percent: '5',
    royalty_splits: defaultWalletSplitFormRows(creator),
    mint_fund_splits: defaultWalletSplitFormRows(treasury),
    ...partial,
  }
}

/** Primary “mint opens” timestamp for cards — PUBLIC schedule, else kickoff. */
export function resolveMintOpensAt(
  launch: Pick<OwlCenterLaunchPublic, 'launch_deadline_at' | 'phase_schedule'>
): string | null {
  return launch.phase_schedule?.PUBLIC ?? launch.launch_deadline_at ?? null
}
