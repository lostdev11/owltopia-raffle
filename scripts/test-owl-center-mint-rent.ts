/**
 * Unit checks for live Owl Center mint rent reserve (SIMD-0437-safe RPC path).
 */
import assert from 'node:assert/strict'

import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getMintSize, getTokenSize } from '@metaplex-foundation/mpl-toolbox'

import {
  clearOwlCenterMintRentCacheForTests,
  getOwlCenterMintRentReservePerNftLamports,
  OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS_FALLBACK,
  OWL_CENTER_MINT_TX_FEE_BUFFER_LAMPORTS,
  sumRentExemptMinimumLamports,
} from '@/lib/solana/owl-center-mint-rent'

async function main() {
  clearOwlCenterMintRentCacheForTests()
  const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed')
  const tmSizes = [getMintSize(), 679, 282, getTokenSize()]
  const liveRent = await sumRentExemptMinimumLamports(conn, tmSizes)
  assert.ok(liveRent > 0n, 'live rent should be positive')
  assert.ok(
    liveRent + OWL_CENTER_MINT_TX_FEE_BUFFER_LAMPORTS < OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS_FALLBACK,
    'post-SIMD live rent + tx buffer should be below legacy 0.02 SOL fallback'
  )

  const perNft = await getOwlCenterMintRentReservePerNftLamports('mainnet', 'gen2_full')
  assert.equal(perNft, liveRent + OWL_CENTER_MINT_TX_FEE_BUFFER_LAMPORTS)

  const perCore = await getOwlCenterMintRentReservePerNftLamports('mainnet', 'public_simple')
  assert.ok(perCore > 0n)
  assert.ok(perCore < OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS_FALLBACK)

  console.log(
    `test-owl-center-mint-rent: ok (gen2 ~${(Number(perNft) / LAMPORTS_PER_SOL).toFixed(6)} SOL/NFT, core ~${(Number(perCore) / LAMPORTS_PER_SOL).toFixed(6)} SOL/NFT)`
  )
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
