/**
 * Read-only diagnostic: inspect the Gen2 candy guard groups, compare each group's on-chain
 * allowList merkle root to the current server-computed root, and check whether the allowList
 * proof PDA exists on-chain for the airdrop wallets that bot-taxed.
 *
 *   npx --yes tsx --env-file=.env.local scripts/inspect-gen2-allowlist.ts
 */
import bs58 from 'bs58'
import { isSome, publicKey, type Option, type Umi } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  fetchCandyMachine,
  getMerkleRoot,
  mplCandyMachine,
  safeFetchCandyGuard,
  safeFetchAllowListProofFromSeeds,
} from '@metaplex-foundation/mpl-candy-machine'

import { listGen1MerkleWallets } from '@/lib/db/gen2-gen1-snapshot'
import { listWlMerkleWallets } from '@/lib/db/owl-center-wl-allocations'
import { listGen2PresaleMerkleWallets } from '@/lib/gen2-presale/db'

const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

// Airdrop wallets that bot-taxed (fee payers of the 9 failed AIRDROP txs).
const AIRDROP_WALLETS = [
  'DNoggcEL6DGdQAjaqxK7v5ktZchvXKtZdkaN6FPx2Fj1',
  '79YtL7eAGzizTcqvHGrNRzzdCxSty15Lof3TeZApC76V',
  'BHZjZert1112UdL4mR86ozcBRfbfyS6dvoHro6zu259M',
]

function b58Root(root: Uint8Array): string {
  return bs58.encode(root)
}

async function main() {
  const umi: Umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplCandyMachine())
  const cmPk = publicKey(CM_ID)
  const cm = await fetchCandyMachine(umi, cmPk)
  const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
  if (!guard) throw new Error('No candy guard at CM mintAuthority')

  console.log(`CM ${CM_ID}`)
  console.log(`candyGuard ${String(guard.publicKey)}`)
  console.log(`itemsLoaded=${cm.itemsLoaded} itemsRedeemed=${cm.itemsRedeemed}`)
  console.log('')

  // Current server merkle roots (what wl-proof would serve right now).
  const [gen1Wallets, preWallets, wlWallets] = await Promise.all([
    listGen1MerkleWallets(),
    listGen2PresaleMerkleWallets(),
    listWlMerkleWallets(),
  ])
  const serverRoots: Record<string, string> = {
    gen1: b58Root(getMerkleRoot(gen1Wallets)),
    pre: b58Root(getMerkleRoot(preWallets)),
    wl: b58Root(getMerkleRoot(wlWallets)),
  }
  const serverCounts: Record<string, number> = {
    gen1: gen1Wallets.length,
    pre: preWallets.length,
    wl: wlWallets.length,
  }

  console.log('=== guard groups (on-chain) ===')
  for (const g of guard.groups) {
    const guards = g.guards
    const al = guards.allowList
    const onChainRoot = isSome(al) ? b58Root(new Uint8Array(al.value.merkleRoot)) : null
    const server = serverRoots[g.label]
    const match = onChainRoot && server ? (onChainRoot === server ? 'MATCH' : 'MISMATCH') : 'n/a'
    const activeGuards = Object.entries(guards as unknown as Record<string, unknown>)
      .filter(([, v]) => isSome(v as Option<unknown>))
      .map(([k]) => k)
    console.log(`  [${g.label}] guards: ${activeGuards.join(', ')}`)
    if (onChainRoot) {
      console.log(`     allowList onchain root = ${onChainRoot}`)
      console.log(`     server root            = ${server ?? '(no server list)'} (${serverCounts[g.label] ?? '?'} wallets) -> ${match}`)
    }
  }

  // Does the allowList proof PDA exist for each airdrop wallet (under the on-chain gen1 root)?
  const gen1Group = guard.groups.find((g) => g.label === 'gen1')
  if (gen1Group && isSome(gen1Group.guards.allowList)) {
    const onChainGen1Root = new Uint8Array(gen1Group.guards.allowList.value.merkleRoot)
    console.log('\n=== gen1 allowList proof PDA existence (under ON-CHAIN gen1 root) ===')
    for (const w of AIRDROP_WALLETS) {
      const proof = await safeFetchAllowListProofFromSeeds(umi, {
        merkleRoot: onChainGen1Root,
        user: publicKey(w),
        candyGuard: guard.publicKey,
        candyMachine: cmPk,
      })
      console.log(`  ${w}  proofPDA=${proof ? 'EXISTS' : 'MISSING'}`)
    }
  } else {
    console.log('\n!! No gen1 group with allowList found on-chain.')
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('inspect failed:', e)
    process.exit(1)
  })
