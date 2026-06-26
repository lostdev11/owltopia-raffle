/**
 * Gen2 guard prep — prints the on-chain values you paste into
 * collections/owltopia-gen2/config.json before `sugar guard add` / `sugar guard update`.
 *
 *  - allowList merkle roots (base58) for the gen1 / pre / wl groups, computed from the
 *    EXACT same wallet lists + ordering the site minter uses (so client proofs validate).
 *  - SOL `value` for the wl / pub freezeSolPayment guards, pegged to the launch USD prices
 *    at the live Jupiter SOL/USD spot.
 *
 * Run: npx --yes tsx --env-file=.env.local scripts/gen2-guard-prep.ts
 *
 * Lists must be FROZEN (no WL adds / presale refunds, Gen1 snapshot taken) before you set the
 * roots on-chain — re-run after any list change and `sugar guard update`.
 */
import bs58 from 'bs58'
import { getMerkleRoot } from '@metaplex-foundation/mpl-candy-machine'

import { listGen1MerkleWallets } from '@/lib/db/gen2-gen1-snapshot'
import { listWlMerkleWallets } from '@/lib/db/owl-center-wl-allocations'
import { listGen2PresaleMerkleWallets } from '@/lib/gen2-presale/db'
import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'

const WL_PRICE_USD = 30
const PUB_PRICE_USD = 40

function rootOf(wallets: string[]): string | null {
  if (wallets.length === 0) return null
  return bs58.encode(getMerkleRoot(wallets))
}

async function main() {
  const [gen1, pre, wl] = await Promise.all([
    listGen1MerkleWallets(),
    listGen2PresaleMerkleWallets(),
    listWlMerkleWallets(),
  ])

  console.log('=== allowList merkle roots (paste into config.json group guards) ===')
  console.log(`gen1 (AIRDROP)  wallets=${gen1.length}  root=${rootOf(gen1) ?? 'EMPTY — take Gen1 snapshot first'}`)
  console.log(`pre  (PRESALE)  wallets=${pre.length}  root=${rootOf(pre) ?? 'EMPTY'}`)
  console.log(`wl   (WHITELIST) wallets=${wl.length}  root=${rootOf(wl) ?? 'EMPTY'}`)

  let solUsd = 0
  try {
    solUsd = await resolveGen2SolUsdPrice()
  } catch (e) {
    console.log('\n(SOL/USD unavailable — set freezeSolPayment values manually):', e instanceof Error ? e.message : e)
  }
  if (solUsd > 0) {
    const wlSol = WL_PRICE_USD / solUsd
    const pubSol = PUB_PRICE_USD / solUsd
    console.log(`\n=== freezeSolPayment values @ $${solUsd.toFixed(2)}/SOL ===`)
    console.log(`wl  ($${WL_PRICE_USD}) -> value: ${wlSol.toFixed(4)}  SOL`)
    console.log(`pub ($${PUB_PRICE_USD}) -> value: ${pubSol.toFixed(4)}  SOL`)
    console.log('(The reprice cron re-pegs wl/pub to these USD targets as SOL moves.)')
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('prep failed:', e)
    process.exit(1)
  })
