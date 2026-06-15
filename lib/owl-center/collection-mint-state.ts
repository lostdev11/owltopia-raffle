import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import type { PresaleMintPoolSnapshot } from '@/lib/owl-center/presale-mint-pool'
import { getPresaleMintPoolSnapshot } from '@/lib/owl-center/presale-mint-pool'
import { launchHasPresaleProgram } from '@/lib/owl-center/launch-presale'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { getLaunchPriceLamportsQuotes } from '@/lib/owl-center/launch-price-quotes'
import { buildOwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import type { CollectionMintStateResponse, MintTerminalLine } from '@/lib/owl-center/types'
import { maybeReconcileLaunchMintsFromChain } from '@/lib/owl-center/reconcile-launch-mints'
import { fetchCandyMachineOnChainSupply } from '@/lib/solana/candy-machine-supply'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function buildCollectionMintState(
  slug: string,
  opts?: { includeSystemLogs?: boolean }
): Promise<CollectionMintStateResponse | null> {
  let launch = await getOwlCenterLaunchBySlug(slug)
  if (!launch || launch.mint_mode !== 'public_simple') return null

  await maybeReconcileLaunchMintsFromChain(launch)
  launch = (await getOwlCenterLaunchBySlug(slug)) ?? launch

  const db = getSupabaseAdmin()
  const [mintRows, logRows, mpRow, prices_lamports, recordedMints] = await Promise.all([
    db
      .from('owl_center_mint_events')
      .select('id,wallet_address,quantity,phase,tx_signature,network,created_at')
      .eq('launch_id', launch.id)
      .order('created_at', { ascending: false })
      .limit(40),
    db
      .from('owl_center_activity_logs')
      .select('id,message,event_type,created_at')
      .eq('launch_id', launch.id)
      .order('created_at', { ascending: false })
      .limit(25),
    db
      .from('owl_center_marketplace_readiness')
      .select('trading_links_active,magic_eden_url,tensor_url,hash_list_text,sellout_prepared_at')
      .eq('launch_id', launch.id)
      .maybeSingle(),
    getLaunchPriceLamportsQuotes(launch),
    collectMintedNftMintsForLaunch(launch.id),
  ])

  const mintLines: MintTerminalLine[] = (mintRows.data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    const w = String(row.wallet_address ?? '')
    const short = w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
    const net = String(row.network ?? 'mainnet')
    return {
      id: String(row.id),
      kind: 'mint' as const,
      message: `MINT [${net}] ${row.phase} qty=${row.quantity} ${short} sig=${String(row.tx_signature ?? '').slice(0, 12)}…`,
      created_at: String(row.created_at ?? ''),
    }
  })

  const sysLines: MintTerminalLine[] = (logRows.data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      kind: 'system' as const,
      message: String(row.message ?? ''),
      created_at: String(row.created_at ?? ''),
    }
  })

  const includeSystemLogs = opts?.includeSystemLogs ?? false

  const terminal = (includeSystemLogs ? [...mintLines, ...sysLines] : mintLines)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50)

  const mint_network = resolveLaunchMintNetwork(launch)
  const dbRemaining = Math.max(0, launch.total_supply - launch.minted_count)
  const cmId = getLaunchCandyMachineId(launch, mint_network)
  const onChainSupply = cmId ? await fetchCandyMachineOnChainSupply(cmId, mint_network) : { ok: false as const }
  const onChainRemaining = onChainSupply.ok ? onChainSupply.remaining : null
  const remaining = onChainRemaining != null ? Math.min(dbRemaining, onChainRemaining) : dbRemaining
  const pct = launch.total_supply > 0 ? ((launch.total_supply - remaining) / launch.total_supply) * 100 : 0
  const mp = mpRow.data as {
    trading_links_active?: boolean
    magic_eden_url?: string | null
    tensor_url?: string | null
    hash_list_text?: string | null
    sellout_prepared_at?: string | null
  } | null

  const presale_pool: PresaleMintPoolSnapshot | null = launchHasPresaleProgram(launch)
    ? await getPresaleMintPoolSnapshot(
        launch.id,
        Math.max(1, launch.presale_supply),
        launch.presale_overage_supply ?? 0,
        mint_network,
        { slug: launch.slug }
      )
    : null

  return {
    launch,
    minted_mints: recordedMints,
    mint_controls: buildOwlCenterMintControls(launch.is_paused),
    marketplace: {
      trading_links_active: Boolean(mp?.trading_links_active),
      magic_eden_url: mp?.magic_eden_url?.trim() || launch.magic_eden_url,
      tensor_url: mp?.tensor_url?.trim() || launch.tensor_url,
      hash_list_ready: Boolean(mp?.hash_list_text?.trim()) || recordedMints.length > 0,
      sellout_prepared_at: mp?.sellout_prepared_at ?? null,
      mint_addresses_recorded: recordedMints.length,
    },
    supply: {
      total: launch.total_supply,
      minted: launch.minted_count,
      remaining,
      percent_minted: pct,
    },
    prices_usdc: { public: launch.public_price_usdc },
    prices_lamports: { public: prices_lamports.public },
    mint_network,
    presale_pool,
    terminal,
  }
}
