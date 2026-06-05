import { getBalanceByWallet, type Gen2BalanceRow } from '@/lib/gen2-presale/db'
import {
  gen2PresalePurchasedCreditsAvailable,
  isGen2PresalePaidParticipant,
} from '@/lib/gen2-presale/presale-participation'
import { getPrimaryWalletForAddress, getWalletClusterAddresses } from '@/lib/db/wallet-links'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type Gen2ClusterWalletBalance = Gen2BalanceRow & {
  is_connected_wallet: boolean
  is_paid_participant: boolean
  purchased_available_mints: number
}

export type Gen2ClusterPresaleSummary = {
  primary_wallet: string
  cluster_wallets: string[]
  linked_count: number
  wallets: Gen2ClusterWalletBalance[]
  totals: {
    purchased_mints: number
    gifted_mints: number
    used_mints: number
    available_mints: number
    purchased_available_mints: number
  }
  paid_participant_count: number
}

export async function getGen2ClusterPresaleSummary(
  sessionWallet: string,
  connectedWallet?: string | null
): Promise<Gen2ClusterPresaleSummary | null> {
  const session = normalizeSolanaWalletAddress(sessionWallet)
  if (!session) return null

  const primary = (await getPrimaryWalletForAddress(session)) ?? session
  const cluster = await getWalletClusterAddresses(primary)
  const connected = connectedWallet ? normalizeSolanaWalletAddress(connectedWallet) : null

  const wallets: Gen2ClusterWalletBalance[] = []
  for (const w of cluster) {
    const bal = await getBalanceByWallet(w)
    const row: Gen2BalanceRow = {
      wallet: w,
      purchased_mints: bal?.purchased_mints ?? 0,
      gifted_mints: bal?.gifted_mints ?? 0,
      used_mints: bal?.used_mints ?? 0,
      available_mints: bal?.available_mints ?? 0,
    }
    wallets.push({
      ...row,
      is_connected_wallet: connected != null && w === connected,
      is_paid_participant: isGen2PresalePaidParticipant(row),
      purchased_available_mints: gen2PresalePurchasedCreditsAvailable(row),
    })
  }

  const totals = wallets.reduce(
    (acc, row) => ({
      purchased_mints: acc.purchased_mints + row.purchased_mints,
      gifted_mints: acc.gifted_mints + row.gifted_mints,
      used_mints: acc.used_mints + row.used_mints,
      available_mints: acc.available_mints + row.available_mints,
      purchased_available_mints: acc.purchased_available_mints + row.purchased_available_mints,
    }),
    {
      purchased_mints: 0,
      gifted_mints: 0,
      used_mints: 0,
      available_mints: 0,
      purchased_available_mints: 0,
    }
  )

  return {
    primary_wallet: primary,
    cluster_wallets: cluster,
    linked_count: Math.max(0, cluster.length - 1),
    wallets,
    totals,
    paid_participant_count: wallets.filter((w) => w.is_paid_participant).length,
  }
}
