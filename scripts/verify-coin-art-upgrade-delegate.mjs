#!/usr/bin/env node
/**
 * Read-only check: is COIN_ART_UPGRADE_AUTHORITY_WALLET listed as an
 * additional UpdateDelegate on the Owltopia Coins collection?
 *
 *   COIN_ART_UPGRADE_AUTHORITY_WALLET=<pubkey> node scripts/verify-coin-art-upgrade-delegate.mjs
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { fetchCollection, mplCore } from '@metaplex-foundation/mpl-core'

const DEFAULT_COLLECTION = 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB'

function resolveRpc() {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    (process.env.HELIUS_API_KEY?.trim()
      ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY.trim())}`
      : 'https://api.mainnet-beta.solana.com')
  )
}

async function main() {
  const hotWallet = process.env.COIN_ART_UPGRADE_AUTHORITY_WALLET?.trim()
  if (!hotWallet) throw new Error('COIN_ART_UPGRADE_AUTHORITY_WALLET is required.')

  const collectionAddress =
    process.env.OWLTOPIA_COIN_COLLECTION_ADDRESS?.trim() ||
    process.env.NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS?.trim() ||
    DEFAULT_COLLECTION

  const umi = createUmi(resolveRpc()).use(mplCore())
  const collection = await fetchCollection(umi, publicKey(collectionAddress))
  const delegates = (collection.updateDelegate?.additionalDelegates ?? []).map(String)

  console.log(`Collection:           ${collectionAddress}`)
  console.log(`Update authority:     ${String(collection.updateAuthority)}`)
  console.log(`Looking for hot key:  ${hotWallet}`)
  console.log(`additionalDelegates:`)
  for (const d of delegates) console.log(`  - ${d}${d === hotWallet ? '  ← match' : ''}`)

  if (delegates.includes(hotWallet)) {
    console.log('\nOK — hot key is authorized. Coin art upgrades can use COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY.')
    process.exit(0)
  }

  console.log('\nNOT authorized yet. Gembird still needs to run authorize-coin-art-upgrade-delegate.mjs.')
  process.exit(2)
}

main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
