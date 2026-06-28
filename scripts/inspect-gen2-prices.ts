/**
 * Read-only diagnostic: print the solPayment / freezeSolPayment lamport VALUES for each
 * Gen2 candy guard group, plus the phase -> group label mapping the site minter uses.
 *
 *   npx --yes tsx --env-file=.env.local scripts/inspect-gen2-prices.ts
 */
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { isSome, publicKey, type Umi } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine, safeFetchCandyGuard } from '@metaplex-foundation/mpl-candy-machine'

import { gen2GuardGroupLabel } from '@/lib/solana/gen2-guards'

const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

function fmt(lamports: bigint): string {
  return `${lamports.toString()} lamports = ${(Number(lamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL`
}

async function main() {
  const umi: Umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplCandyMachine())
  const cm = await fetchCandyMachine(umi, publicKey(CM_ID))
  const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
  if (!guard) throw new Error('No candy guard at CM mintAuthority')

  console.log(`CM ${CM_ID}  guard ${String(guard.publicKey)}`)
  console.log(`guard authority = ${String(guard.authority)}`)
  console.log('')

  console.log('=== phase -> group label (site minter) ===')
  for (const phase of ['AIRDROP', 'PRESALE', 'WHITELIST', 'PUBLIC'] as const) {
    console.log(`  ${phase.padEnd(10)} -> ${gen2GuardGroupLabel(phase) ?? '(default guard set / none)'}`)
  }
  console.log('')

  console.log('=== payment + limit guards per group ===')
  for (const g of guard.groups) {
    const sp = g.guards.solPayment
    const fsp = g.guards.freezeSolPayment
    const ml = g.guards.mintLimit
    const ra = g.guards.redeemedAmount
    const sd = g.guards.startDate
    const spStr = isSome(sp) ? fmt(sp.value.lamports.basisPoints) : 'NONE'
    const fspStr = isSome(fsp) ? fmt(fsp.value.lamports.basisPoints) : 'NONE'
    console.log(`  [${g.label}]`)
    console.log(`     solPayment       = ${spStr}`)
    console.log(`     freezeSolPayment = ${fspStr}`)
    console.log(`     mintLimit        = ${isSome(ml) ? `id=${ml.value.id} limit=${ml.value.limit}` : 'NONE'}`)
    console.log(`     redeemedAmount   = ${isSome(ra) ? `max=${ra.value.maximum.toString()}` : 'NONE'}`)
    console.log(`     startDate        = ${isSome(sd) ? new Date(Number(sd.value.date) * 1000).toISOString() : 'NONE'}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('inspect failed:', e)
    process.exit(1)
  })
