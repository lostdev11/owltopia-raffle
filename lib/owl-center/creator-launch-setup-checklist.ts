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
  const liveStatus =
    launch.status === 'PUBLIC' ||
    launch.status === 'WHITELIST' ||
    launch.status === 'TRADING_ACTIVE' ||
    launch.active_phase === 'PUBLIC'
  const hasCm = Boolean(launch.candy_machine_id?.trim() || launch.devnet_candy_machine_id?.trim())
  return liveStatus && hasCm
}

/**
 * Partner Manage collection guided steps (Phase A UX).
 * Allowlist + wallets are optional when no allowlist is configured.
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
  const freezeOn = launch.mint_standard === 'core' && launch.freeze_enabled
  const tradingDone = !freezeOn || launch.freeze_status === 'thawed'
  const tradingWaiting =
    freezeOn && launch.freeze_status !== 'thawed' && (launch.minted_count > 0 || liveDone)

  return [
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
        ? 'Mint page is live — share the link with your community.'
        : launch.is_paused
          ? 'Mint is paused. Unpause / go live with your Owl Center contact when ready.'
          : 'Copy your mint link below. Go-live usually needs CM deploy + approval.',
      status: liveDone ? 'done' : 'todo',
      href: '#mint-share-link',
    },
    {
      id: 'trading',
      title: '5. Enable trading',
      hint: !freezeOn
        ? 'Lock-at-mint is off — NFTs are transferable when minted.'
        : launch.freeze_status === 'thawed'
          ? 'Trading unlocked for the whole collection.'
          : tradingWaiting
            ? 'After mint (or when ready for secondary), unlock trading below. Do not unlock to freeze.'
            : 'You chose lock-at-mint. Unlock trading only when mint is done.',
      status: !freezeOn ? 'skipped' : tradingDone ? 'done' : tradingWaiting ? 'waiting' : 'todo',
      href: '#enable-trading',
    },
  ]
}

export function creatorSetupChecklistProgress(steps: CreatorSetupStep[]): {
  requiredDone: number
  requiredTotal: number
} {
  const required = steps.filter((s) => s.status !== 'skipped')
  const requiredDone = required.filter((s) => s.status === 'done').length
  return { requiredDone, requiredTotal: required.length }
}
