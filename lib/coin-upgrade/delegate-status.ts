import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { fetchCollection, mplCore } from '@metaplex-foundation/mpl-core'
import { getCoinArtUpdateAuthorityWallet } from '@/lib/coin-upgrade/update-authority-keypair'
import {
  OWLTOPIA_COIN_COLLECTION_UPDATE_AUTHORITY,
  resolveOwltopiaCoinCollectionAddress,
} from '@/lib/coin-upgrade/collection'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export type CoinArtUpgradeDelegateStatus = {
  collection: string
  update_authority: string
  expected_update_authority: string
  hot_wallet: string | null
  hot_wallet_configured: boolean
  authorized: boolean
  additional_delegates: string[]
  authority_matches_expected: boolean
}

/**
 * Read-only on-chain check: is the configured hot key already an UpdateDelegate?
 * Safe to expose to the authorize page (pubkeys only — no secrets).
 */
export async function getCoinArtUpgradeDelegateStatus(): Promise<CoinArtUpgradeDelegateStatus> {
  const collection = resolveOwltopiaCoinCollectionAddress()
  const hotWallet = getCoinArtUpdateAuthorityWallet() || null
  const endpoint = resolveServerSolanaRpcUrl()
  const umi = createUmi(endpoint).use(mplCore())
  const account = await fetchCollection(umi, publicKey(collection))
  const updateAuthority = String(account.updateAuthority)
  const additionalDelegates = (account.updateDelegate?.additionalDelegates ?? []).map(String)

  return {
    collection,
    update_authority: updateAuthority,
    expected_update_authority: OWLTOPIA_COIN_COLLECTION_UPDATE_AUTHORITY,
    hot_wallet: hotWallet,
    hot_wallet_configured: Boolean(hotWallet),
    authorized: hotWallet ? additionalDelegates.includes(hotWallet) : false,
    additional_delegates: additionalDelegates,
    authority_matches_expected: updateAuthority === OWLTOPIA_COIN_COLLECTION_UPDATE_AUTHORITY,
  }
}
