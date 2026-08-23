import { LAMPORTS_PER_SOL } from '@solana/web3.js'

/**
 * Owltopia Coin NFT art upgrade (community vote):
 * optional per-coin fee that repoints the MPL Core URI to the new art and
 * doubles nested OWL rewards for that coin. Server env only — the UI reads
 * this config from `GET /api/me/coin-upgrade`.
 */

const DEFAULT_FEE_SOL = 0.5
const DEFAULT_REWARD_MULTIPLIER = 2

function readBoolean(raw: string | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** Ship dark until the community vote passes; flip `COIN_ART_UPGRADE_ENABLED=true` to launch. */
export function isCoinArtUpgradeEnabled(): boolean {
  return readBoolean(process.env.COIN_ART_UPGRADE_ENABLED)
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

/** Upgraded coins earn `pool rate × multiplier` while nested (vote: 1 → 2 OWL/day). */
export function getCoinArtUpgradeRewardMultiplier(): number {
  const raw = process.env.COIN_ART_UPGRADE_REWARD_MULTIPLIER?.trim()
  if (!raw) return DEFAULT_REWARD_MULTIPLIER
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_REWARD_MULTIPLIER
}

/** Bound per-request work: each coin needs a server-signed Core update transaction. */
export const MAX_COIN_ART_UPGRADES_PER_REQUEST = 10
