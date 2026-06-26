/**
 * Read-only inspection of the Gen2 Candy Machine + Candy Guard on mainnet.
 * No keys required. Prints supply, groups, start dates, payment/freeze guards,
 * allowList merkle roots, mintLimit, botTax, redeemedAmount.
 *
 * Run: node --env-file=.env.local scripts/inspect-gen2-guards.mjs
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey, isSome } from '@metaplex-foundation/umi'
import {
  mplCandyMachine,
  fetchCandyMachine,
  safeFetchCandyGuard,
} from '@metaplex-foundation/mpl-candy-machine'
import bs58 from 'bs58'

const CM_ID = process.env.GEN2_CM_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const LAMPORTS_PER_SOL = 1_000_000_000

function fmtDate(opt) {
  if (!isSome(opt)) return null
  const ts = Number(opt.value.date)
  return new Date(ts * 1000).toISOString()
}

function describeGuards(guards) {
  const out = {}
  if (isSome(guards.startDate)) out.startDate = fmtDate(guards.startDate)
  if (isSome(guards.endDate)) out.endDate = fmtDate(guards.endDate)
  if (isSome(guards.solPayment)) {
    out.solPayment = {
      sol: Number(guards.solPayment.value.lamports.basisPoints) / LAMPORTS_PER_SOL,
      destination: String(guards.solPayment.value.destination),
    }
  }
  if (isSome(guards.freezeSolPayment)) {
    out.freezeSolPayment = {
      sol: Number(guards.freezeSolPayment.value.lamports.basisPoints) / LAMPORTS_PER_SOL,
      destination: String(guards.freezeSolPayment.value.destination),
    }
  }
  if (isSome(guards.tokenPayment)) {
    out.tokenPayment = {
      amount: String(guards.tokenPayment.value.amount),
      mint: String(guards.tokenPayment.value.mint),
    }
  }
  if (isSome(guards.mintLimit)) {
    out.mintLimit = { id: guards.mintLimit.value.id, limit: guards.mintLimit.value.limit }
  }
  if (isSome(guards.redeemedAmount)) {
    out.redeemedAmount = { maximum: String(guards.redeemedAmount.value.maximum) }
  }
  if (isSome(guards.allowList)) {
    out.allowList = { merkleRoot: bs58.encode(Uint8Array.from(guards.allowList.value.merkleRoot)) }
  }
  if (isSome(guards.botTax)) {
    out.botTax = {
      sol: Number(guards.botTax.value.lamports.basisPoints) / LAMPORTS_PER_SOL,
      lastInstruction: guards.botTax.value.lastInstruction,
    }
  }
  if (isSome(guards.addressGate)) out.addressGate = String(guards.addressGate.value.address)
  if (isSome(guards.thirdPartySigner)) {
    out.thirdPartySigner = { signerKey: String(guards.thirdPartySigner.value.signerKey) }
  }
  return out
}

async function main() {
  const umi = createUmi(RPC).use(mplCandyMachine())
  const cm = await fetchCandyMachine(umi, publicKey(CM_ID))

  console.log('=== Candy Machine ===')
  console.log('address      :', String(cm.publicKey))
  console.log('authority    :', String(cm.authority))
  console.log('mintAuthority:', String(cm.mintAuthority))
  console.log('collectionMint:', String(cm.collectionMint))
  console.log('itemsLoaded  :', cm.itemsLoaded)
  console.log('itemsRedeemed:', String(cm.itemsRedeemed))
  console.log('itemsAvailable:', String(cm.data.itemsAvailable))
  console.log('isMutable    :', cm.data.isMutable)
  console.log('sellerFeeBP  :', cm.data.sellerFeeBasisPoints)

  const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
  if (!guard) {
    console.log('\n!!! No Candy Guard found at mintAuthority — mint UI will reject.')
    return
  }
  console.log('\n=== Candy Guard ===')
  console.log('address  :', String(guard.publicKey))
  console.log('authority:', String(guard.authority))
  console.log('\ndefault guards:', JSON.stringify(describeGuards(guard.guards), null, 2))
  console.log('\ngroups (' + guard.groups.length + '):')
  for (const g of guard.groups) {
    console.log(`\n  [${g.label}] ->`, JSON.stringify(describeGuards(g.guards), null, 2))
  }
}

main().catch((e) => {
  console.error('inspect failed:', e)
  process.exit(1)
})
