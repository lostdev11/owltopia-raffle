/**
 * Auto / manual Gen2 team backstop mint ops (leftover supply after public pool empties).
 */
import { getAdmins } from '@/lib/db/admins'
import {
  getOwlCenterLaunchBySlugAdmin,
  updateOwlCenterLaunchAdmin,
} from '@/lib/db/owl-center-launch'
import { gen2PublicMintPoolRemaining } from '@/lib/owl-center/gen2-phase-advance'
import { mergeFreezeProgress } from '@/lib/owl-center/gen2-freeze-thaw'
import {
  enableGen2TeamBackstopGuards,
  parseGen2TeamMintWallets,
} from '@/lib/owl-center/gen2-team-backstop-guards'
import { sumOwlCenterPhaseMinted } from '@/lib/owl-center/presale-mint-pool'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { resolveEffectiveCmRemaining } from '@/lib/owl-center/effective-cm-remaining'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getGen2CandyMachineId, isDevnetMintEnabled } from '@/lib/solana/network'

function parseAdminWalletsFromEnv(): string[] {
  const raw = process.env.ADMIN_WALLETS?.trim()
  if (!raw) return []
  return raw
    .split(/[\s,]+/)
    .map((s) => normalizeSolanaWalletAddress(s.trim()))
    .filter((x): x is string => Boolean(x))
}

/** Team allowlist: GEN2_TEAM_MINT_WALLETS ∪ ADMIN_WALLETS ∪ DB full admins ∪ optional session wallet. */
export async function resolveGen2TeamBackstopWallets(extraWallet?: string | null): Promise<string[]> {
  const set = new Set<string>()
  for (const w of [...parseGen2TeamMintWallets(extraWallet), ...parseAdminWalletsFromEnv()]) {
    set.add(w)
  }
  try {
    const dbAdmins = await getAdmins()
    for (const row of dbAdmins) {
      const role = typeof row?.role === 'string' ? row.role : 'full'
      if (role !== 'full') continue
      const addr = typeof row?.wallet_address === 'string' ? row.wallet_address : ''
      const n = normalizeSolanaWalletAddress(addr)
      if (n) set.add(n)
    }
  } catch (e) {
    console.warn('[gen2-backstop] getAdmins failed', e)
  }
  return [...set]
}

async function publicPoolRemaining(launch: OwlCenterLaunchPublic): Promise<number> {
  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const [publicMinted, wlMinted] = await Promise.all([
    sumOwlCenterPhaseMinted(launch.id, 'PUBLIC', network),
    sumOwlCenterPhaseMinted(launch.id, 'WHITELIST', network),
  ])
  return gen2PublicMintPoolRemaining({ launch, publicMinted, wlMinted })
}

export type EnsureTeamBackstopResult =
  | { ok: true; enabled: true; already: boolean; signature: string | null; wallets: string[] }
  | { ok: true; enabled: false; skipped: true; reason: string }
  | { ok: false; error: string }

/**
 * Idempotent: when public pool is empty and collection still has remaining, enable the on-chain
 * `team` guard + `backstop_mint_enabled` so admins can mint leftovers without a manual click.
 */
export async function ensureGen2TeamBackstopAutoEnabled(opts?: {
  launch?: OwlCenterLaunchPublic | null
  /** Extra wallet to include (e.g. admin session on manual enable). */
  extraWallet?: string | null
}): Promise<EnsureTeamBackstopResult> {
  const launch = opts?.launch ?? (await getOwlCenterLaunchBySlugAdmin('gen2'))
  if (!launch) return { ok: false, error: 'Launch not found' }

  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const cmRemaining = await resolveEffectiveCmRemaining({
    totalSupply: launch.total_supply,
    mintedCount: launch.minted_count,
    candyMachineId: getGen2CandyMachineId(launch),
    network,
  })
  const remaining = cmRemaining.remaining
  if (remaining <= 0) {
    return {
      ok: true,
      enabled: false,
      skipped: true,
      reason: cmRemaining.onChainSoldOut ? 'on_chain_sold_out' : 'collection_sold_out',
    }
  }

  if (launch.freeze_progress.backstop_mint_enabled) {
    return {
      ok: true,
      enabled: true,
      already: true,
      signature: null,
      wallets:
        launch.freeze_progress.backstop_team_wallets ??
        (await resolveGen2TeamBackstopWallets(opts?.extraWallet)),
    }
  }

  const poolLeft = await publicPoolRemaining(launch)
  if (poolLeft > 0) {
    return { ok: true, enabled: false, skipped: true, reason: `public_pool_remaining=${poolLeft}` }
  }

  const wallets = await resolveGen2TeamBackstopWallets(opts?.extraWallet)
  if (wallets.length === 0) {
    return {
      ok: false,
      error:
        'No team wallets configured — set GEN2_TEAM_MINT_WALLETS / ADMIN_WALLETS, or add a full admin in the DB',
    }
  }

  try {
    const res = await enableGen2TeamBackstopGuards({
      teamWallets: wallets,
      totalSupply: launch.total_supply,
      candyMachineId: getGen2CandyMachineId(launch) || undefined,
    })
    const now = new Date().toISOString()
    const progress = mergeFreezeProgress(launch.freeze_progress, {
      backstop_mint_enabled: true,
      backstop_team_wallets: res.wallets,
      backstop_enabled_at: now,
      updated_at: now,
      error: undefined,
    })
    await updateOwlCenterLaunchAdmin('gen2', { freeze_progress: progress })
    return {
      ok: true,
      enabled: true,
      already: false,
      signature: res.signature,
      wallets: res.wallets,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
