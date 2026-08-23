import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getCoinArtUpgradeSettings } from '@/lib/db/coin-art-upgrade-settings'

/**
 * Owltopia Coin NFT art upgrade (community vote):
 * optional per-coin fee that repoints the MPL Core URI to the new art and
 * doubles nested OWL rewards for that coin. Server env only — the UI reads
 * this config from `GET /api/me/coin-upgrade`.
 */

const DEFAULT_FEE_SOL = 0.1
/** ~$0.50 USD platform fee per coin (paid in SOL to the platform treasury). */
const DEFAULT_PLATFORM_FEE_USD = 0.5
const DEFAULT_REWARD_MULTIPLIER = 2
const ENABLED_CACHE_MS = 5000

let enabledCache: { at: number; value: boolean } | null = null

function readBoolean(raw: string | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** Cleared after admin PATCH so toggles take effect within a few seconds per instance. */
export function invalidateCoinArtUpgradeEnabledCache(): void {
  enabledCache = null
}

/** Deployment-level overrides for `COIN_ART_UPGRADE_ENABLED`. */
export function coinArtUpgradeEnvStatus(): {
  killSwitch: boolean
  forceOn: boolean
} {
  const raw = process.env.COIN_ART_UPGRADE_ENABLED?.trim().toLowerCase()
  return {
    killSwitch: raw === 'false',
    forceOn: readBoolean(process.env.COIN_ART_UPGRADE_ENABLED),
  }
}

/**
 * Master gate: env kill switch / legacy force-on, else admin DB toggle.
 * Default off when unset.
 */
export async function isCoinArtUpgradeEnabled(): Promise<boolean> {
  const env = coinArtUpgradeEnvStatus()
  if (env.killSwitch) return false
  if (env.forceOn) return true

  const now = Date.now()
  if (enabledCache && now - enabledCache.at < ENABLED_CACHE_MS) {
    return enabledCache.value
  }

  const settings = await getCoinArtUpgradeSettings()
  const value = settings.upgrades_enabled === true
  enabledCache = { at: now, value }
  return value
}

export function getCoinArtUpgradeFeeSol(): number {
  const raw = process.env.COIN_ART_UPGRADE_FEE_SOL?.trim()
  if (!raw) return DEFAULT_FEE_SOL
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FEE_SOL
}

export function getCoinArtUpgradeFeeLamports(): number {
  return Math.round(getCoinArtUpgradeFeeSol() * LAMPORTS_PER_SOL)
}

/**
 * USD notional for the platform fee charged per upgraded coin (collected as SOL).
 * Set `COIN_ART_UPGRADE_PLATFORM_FEE_USDC=0` to disable.
 */
export function getCoinArtUpgradePlatformFeeUsd(): number {
  const raw = process.env.COIN_ART_UPGRADE_PLATFORM_FEE_USDC?.trim()
  if (!raw) return DEFAULT_PLATFORM_FEE_USD
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PLATFORM_FEE_USD
}

export function formatCoinArtUpgradePlatformFeeLabel(usd = getCoinArtUpgradePlatformFeeUsd()): string {
  if (usd <= 0) return ''
  const cents = Math.round(usd * 100)
  if (cents === 50) return '50¢ platform fee'
  if (usd % 1 === 0) return `$${usd.toFixed(0)} platform fee`
  return `~$${usd.toFixed(2)} platform fee`
}

/** Upgraded coins earn `pool rate × multiplier` while nested (vote: 1 → 2 OWL/day). */
export function getCoinArtUpgradeRewardMultiplier(): number {
  const raw = process.env.COIN_ART_UPGRADE_REWARD_MULTIPLIER?.trim()
  if (!raw) return DEFAULT_REWARD_MULTIPLIER
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_REWARD_MULTIPLIER
}

/** Bound per-request work: each coin needs a server-signed Core URI update transaction. */
export const MAX_COIN_ART_UPGRADES_PER_REQUEST = 10
