import { getPrimaryWalletForAddress, getWalletClusterAddresses } from '@/lib/db/wallet-links'
import { getOwltopiaGen1Snapshot } from '@/lib/owl-center/owltopia-gen1'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type Gen1ClusterWalletRow = {
  wallet: string
  is_connected_wallet: boolean
  gen1_nft_count: number
}

export type Gen1ClusterSummary = {
  connected_gen1_nft_count: number
  cluster_gen1_nft_count: number
  wallets: Gen1ClusterWalletRow[]
}

export type WlClusterWalletRow = {
  wallet: string
  is_connected_wallet: boolean
  allowed_mints: number
  used_mints: number
  available_mints: number
  community: string | null
}

export type WlClusterSummary = {
  connected_allowed: number
  connected_available: number
  cluster_allowed: number
  cluster_available: number
  wallets: WlClusterWalletRow[]
}

function shortWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

export function formatGen1LinkedWalletHint(wallets: Gen1ClusterWalletRow[]): string | null {
  const linked = wallets.filter((row) => !row.is_connected_wallet && row.gen1_nft_count > 0)
  if (linked.length === 0) return null
  const total = linked.reduce((s, row) => s + row.gen1_nft_count, 0)
  const addrs = linked.map((row) => shortWallet(row.wallet)).join(', ')
  return `${total} Gen1 NFT${total === 1 ? '' : 's'} on linked wallet${linked.length === 1 ? '' : 's'} (${addrs}) — connect that wallet to mint`
}

export function formatWlLinkedWalletHint(wallets: WlClusterWalletRow[]): string | null {
  const linked = wallets.filter((row) => !row.is_connected_wallet && row.available_mints > 0)
  if (linked.length === 0) return null
  const total = linked.reduce((s, row) => s + row.available_mints, 0)
  const addrs = linked.map((row) => shortWallet(row.wallet)).join(', ')
  return `${total} WL spot${total === 1 ? '' : 's'} on linked wallet${linked.length === 1 ? '' : 's'} (${addrs}) — connect that wallet to mint`
}

export async function getGen1ClusterSummary(connectedWallet: string): Promise<Gen1ClusterSummary> {
  const connected = normalizeSolanaWalletAddress(connectedWallet)
  if (!connected) {
    return { connected_gen1_nft_count: 0, cluster_gen1_nft_count: 0, wallets: [] }
  }

  const primary = (await getPrimaryWalletForAddress(connected)) ?? connected
  const cluster = await getWalletClusterAddresses(primary)
  const wallets: Gen1ClusterWalletRow[] = []

  for (const w of cluster) {
    const snap = await getOwltopiaGen1Snapshot(w)
    wallets.push({
      wallet: w,
      is_connected_wallet: w === connected,
      gen1_nft_count: snap.gen1_nft_count,
    })
  }

  const connectedRow = wallets.find((row) => row.is_connected_wallet)
  const connected_gen1_nft_count = connectedRow?.gen1_nft_count ?? 0
  const cluster_gen1_nft_count = wallets.reduce((s, row) => s + row.gen1_nft_count, 0)

  return { connected_gen1_nft_count, cluster_gen1_nft_count, wallets }
}

async function getWlRow(wallet: string): Promise<{
  allowed_mints: number
  used_mints: number
  community: string | null
} | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_wl_allocations').select('*').eq('wallet', wallet).maybeSingle()
  if (error || !data) return null
  const r = data as Record<string, unknown>
  return {
    allowed_mints: Number(r.allowed_mints ?? 0),
    used_mints: Number(r.used_mints ?? 0),
    community: r.community != null ? String(r.community) : null,
  }
}

export async function getWlClusterSummary(connectedWallet: string): Promise<WlClusterSummary> {
  const connected = normalizeSolanaWalletAddress(connectedWallet)
  if (!connected) {
    return {
      connected_allowed: 0,
      connected_available: 0,
      cluster_allowed: 0,
      cluster_available: 0,
      wallets: [],
    }
  }

  const primary = (await getPrimaryWalletForAddress(connected)) ?? connected
  const cluster = await getWalletClusterAddresses(primary)
  const wallets: WlClusterWalletRow[] = []

  for (const w of cluster) {
    const row = await getWlRow(w)
    const allowed = row?.allowed_mints ?? 0
    const used = row?.used_mints ?? 0
    wallets.push({
      wallet: w,
      is_connected_wallet: w === connected,
      allowed_mints: allowed,
      used_mints: used,
      available_mints: Math.max(0, allowed - used),
      community: row?.community ?? null,
    })
  }

  const connectedRow = wallets.find((row) => row.is_connected_wallet)
  const connected_allowed = connectedRow?.allowed_mints ?? 0
  const connected_available = connectedRow?.available_mints ?? 0
  const cluster_allowed = wallets.reduce((s, row) => s + row.allowed_mints, 0)
  const cluster_available = wallets.reduce((s, row) => s + row.available_mints, 0)

  return {
    connected_allowed,
    connected_available,
    cluster_allowed,
    cluster_available,
    wallets,
  }
}
