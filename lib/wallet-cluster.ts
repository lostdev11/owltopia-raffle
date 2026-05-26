import {
  getPrimaryWalletForAddress,
  getWalletClusterAddresses,
  isClusterPrimaryWallet,
  listLinkedWalletsForPrimary,
  type WalletLinkRow,
} from '@/lib/db/wallet-links'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export type WalletClusterSummary = {
  session_wallet: string
  primary_wallet: string
  is_primary: boolean
  linked_wallets: WalletLinkRow[]
  cluster_wallets: string[]
}

export async function resolveWalletCluster(sessionWallet: string): Promise<WalletClusterSummary | null> {
  const session = normalizeSolanaWalletAddress(sessionWallet)
  if (!session) return null

  const primary = (await getPrimaryWalletForAddress(session)) ?? session
  const linked = await listLinkedWalletsForPrimary(primary)
  const cluster = await getWalletClusterAddresses(primary)

  return {
    session_wallet: session,
    primary_wallet: primary,
    is_primary: walletsEqualSolana(session, primary),
    linked_wallets: linked,
    cluster_wallets: cluster,
  }
}

export async function resolvePrimaryWallet(sessionWallet: string): Promise<string | null> {
  return getPrimaryWalletForAddress(sessionWallet)
}

export { getWalletClusterAddresses, isClusterPrimaryWallet }
