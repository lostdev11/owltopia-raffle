import {
  partnerAllowlistEarliestStart,
  resolvePartnerAllowlistPhases,
} from '@/lib/owl-center/partner-allowlist-phases'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type CreatorSetupStepStatus = 'done' | 'todo' | 'waiting' | 'skipped'

export type CreatorSetupStep = {
  id: string
  title: string
  hint: string
  status: CreatorSetupStepStatus
  /** In-page anchor (hash). */
  href: string
}

export type CreatorSetupChecklistInput = {
  launch: OwlCenterLaunchPublic
  /** Wallets uploaded across allowlist phases (optional; omit → treat wallets as todo when allowlist on). */
  allowlistWalletCount?: number | null
}

function hasMintBasics(launch: OwlCenterLaunchPublic): boolean {
  if (launch.total_supply < 1) return false
  const price =
    launch.creator_mint_price != null ||
    launch.public_price_usdc != null ||
    launch.creator_mint_currency != null
  const schedule = Boolean(launch.launch_deadline_at || launch.phase_schedule?.PUBLIC)
  return Boolean(price && schedule)
}

function allowlistConfigured(launch: OwlCenterLaunchPublic): boolean {
  const phases = resolvePartnerAllowlistPhases(launch)
  if (phases.length < 1) return false
  return phases.every((p) => Boolean(p.starts_at) && p.supply > 0)
}

function mintLooksLive(launch: OwlCenterLaunchPublic): boolean {
  if (launch.is_paused) return false
  if (launch.status === 'SOLD_OUT' || launch.active_phase === 'SOLD_OUT') return true
  if (launch.status === 'TRADING_ACTIVE' || launch.active_phase === 'TRADING_ACTIVE') return true
  const liveStatus =
    launch.status === 'PUBLIC' ||
    launch.status === 'WHITELIST' ||
    launch.active_phase === 'PUBLIC'
  const hasCm = Boolean(launch.candy_machine_id?.trim() || launch.devnet_candy_machine_id?.trim())
  return liveStatus && hasCm
}

function isSoldOut(launch: OwlCenterLaunchPublic): boolean {
  if (launch.status === 'SOLD_OUT' || launch.active_phase === 'SOLD_OUT') return true
  if (launch.status === 'TRADING_ACTIVE' || launch.active_phase === 'TRADING_ACTIVE') return true
  return launch.total_supply > 0 && launch.minted_count >= launch.total_supply
}

function hasMarketplaceUrls(launch: OwlCenterLaunchPublic): boolean {
  return Boolean(launch.orbis_url?.trim())
}

function tradingLinksLive(launch: OwlCenterLaunchPublic): boolean {
  return launch.status === 'TRADING_ACTIVE' || launch.active_phase === 'TRADING_ACTIVE'
}

/**
 * Partner Manage collection guided steps (Phase A UX).
 * Allowlist + wallets are optional when no allowlist is configured.
 * After sellout, steps guide hash list → thaw → marketplace URLs → activate trading.
 */
export function buildCreatorLaunchSetupChecklist(
  input: CreatorSetupChecklistInput
): CreatorSetupStep[] {
  const { launch, allowlistWalletCount } = input
  const phases = resolvePartnerAllowlistPhases(launch)
  const hasAllowlist = phases.length > 0
  const allowlistReady = allowlistConfigured(launch)
  const earliest = partnerAllowlistEarliestStart(phases)

  const mintDone = hasMintBasics(launch)
  const walletsKnown = allowlistWalletCount != null
  const walletsDone = !hasAllowlist || (walletsKnown && (allowlistWalletCount ?? 0) > 0)
  const walletsWaiting = hasAllowlist && allowlistReady && !walletsDone

  const liveDone = mintLooksLive(launch)
  const soldOut = isSoldOut(launch)
  const freezeOn = launch.mint_standard === 'core' && launch.freeze_enabled
  const tradingDone = !freezeOn || launch.freeze_status === 'thawed'
  const tradingWaiting =
    freezeOn && launch.freeze_status !== 'thawed' && (launch.minted_count > 0 || liveDone || soldOut)

  const urlsDone = hasMarketplaceUrls(launch)
  const activateDone = tradingLinksLive(launch)

  const steps: CreatorSetupStep[] = [
    {
      id: 'mint-details',
      title: '1. Mint details',
      hint: mintDone
        ? 'Price, supply, and schedule look set.'
        : 'Set price, supply, and when mint / public opens, then save.',
      status: mintDone ? 'done' : 'todo',
      href: '#mint-details',
    },
    {
      id: 'allowlist',
      title: '2. Allowlist phases (optional)',
      hint: !hasAllowlist
        ? 'Skip if you only want public mint — or add Team / OG / WL under Show Advanced.'
        : allowlistReady
          ? `Allowlist ready${earliest ? ` · first opens ${new Date(earliest).toLocaleString()}` : ''}.`
          : 'Add start times and a hard-cap supply for each phase, then save.',
      status: !hasAllowlist ? 'skipped' : allowlistReady ? 'done' : 'todo',
      href: '#mint-details',
    },
    {
      id: 'wallets',
      title: '3. Add wallets',
      hint: !hasAllowlist
        ? 'Not needed until you enable allowlist phases.'
        : walletsDone
          ? `${allowlistWalletCount} wallet(s) on file.`
          : 'Paste wallets for each phase (Team / OG / WL tabs).',
      status: !hasAllowlist ? 'skipped' : walletsDone ? 'done' : walletsWaiting ? 'todo' : 'todo',
      href: '#wl-wallets',
    },
    {
      id: 'share',
      title: '4. Share mint link',
      hint: liveDone
        ? soldOut
          ? 'Mint sold out — share the page for holders, then finish marketplace steps below.'
          : 'Mint page is live — share the link with your community.'
        : launch.is_paused
          ? 'Mint is paused. Unpause / go live with your Owl Center contact when ready.'
          : 'Copy your mint link below. Go-live usually needs CM deploy + approval.',
      status: liveDone ? 'done' : 'todo',
      href: '#mint-share-link',
    },
    {
      id: 'hash-list',
      title: '5. Sellout prep / hash list',
      hint: !soldOut
        ? 'After mint-out, reconcile if needed and download the hash list from the mint page sold-out panel.'
        : 'Sold out — download the hash list from the mint page (or Mint details) for Magic Eden if you need it.',
      status: !soldOut ? 'waiting' : 'done',
      href: '#marketplace-readiness',
    },
    {
      id: 'trading',
      title: '6. Thaw / enable trading',
      hint: !freezeOn
        ? 'Lock-at-mint is off — NFTs are transferable when minted.'
        : launch.freeze_status === 'thawed'
          ? 'Trading unlocked for the whole collection.'
          : tradingWaiting
            ? 'Mint is done (or in progress). Unlock trading below when ready for secondary — do not thaw mid-mint unless product asks for it.'
            : 'You chose lock-at-mint. Unlock trading only when mint is done.',
      status: !freezeOn ? 'skipped' : tradingDone ? 'done' : tradingWaiting ? 'waiting' : 'todo',
      href: '#enable-trading',
    },
    {
      id: 'marketplace-urls',
      title: '7. Paste marketplace URLs',
      hint: !soldOut
        ? 'After sellout, list on Orbis first, then paste Orbis (and optional ME / Tensor) URLs in Mint details.'
        : urlsDone
          ? 'Orbis URL on file — add ME / Tensor if you want, then activate trading links.'
          : 'List on Orbis first, then paste live Orbis (and optional ME / Tensor) URLs in Mint details.',
      status: !soldOut ? 'waiting' : urlsDone ? 'done' : 'todo',
      href: '#marketplace-readiness',
    },
    {
      id: 'activate-trading',
      title: '8. Activate trading links',
      hint: !soldOut
        ? 'When listings are live, activate trading links on Mint details to flip the mint page to TRADING_ACTIVE.'
        : activateDone
          ? 'Trading links are live on the mint page.'
          : freezeOn && launch.freeze_status !== 'thawed'
            ? 'Thaw / unlock trading first, then activate trading links so holders see Orbis / ME / Tensor.'
            : 'Confirm and activate trading links on Mint details so the public mint page shows trade CTAs.',
      status: !soldOut ? 'waiting' : activateDone ? 'done' : 'todo',
      href: '#marketplace-readiness',
    },
  ]

  return steps
}

export function creatorSetupChecklistProgress(steps: CreatorSetupStep[]): {
  requiredDone: number
  requiredTotal: number
} {
  const required = steps.filter((s) => s.status !== 'skipped')
  const requiredDone = required.filter((s) => s.status === 'done').length
  return { requiredDone, requiredTotal: required.length }
}
