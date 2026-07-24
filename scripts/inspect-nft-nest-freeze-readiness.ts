/**
 * Read-only: sample Gen 2 (or any legacy TM) mints and report nest-lock readiness.
 *
 * Gen 2 Metaplex NFTs keep freeze authority on the Master Edition PDA — SetAuthority reassignment
 * is not possible. Ready means: thawed ATA + Master Edition path (wallet Approve + server
 * FreezeDelegatedAccount) OR mint freeze authority already equals the nesting wallet.
 *
 *   npx --yes tsx --env-file=.env.local scripts/inspect-nft-nest-freeze-readiness.ts
 *   npx --yes tsx --env-file=.env.local scripts/inspect-nft-nest-freeze-readiness.ts --collection=<mint>
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { getNestingNftFreezeAuthorityWallet } from '@/lib/nesting/freeze-authority-keypair'
import { detectSplNestFreezePath } from '@/lib/solana/token-metadata-nest-lock'
import { getGen2CollectionMint } from '@/lib/solana/network'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

type DasItem = {
  id?: string
  ownership?: { owner?: string; frozen?: boolean }
}

async function fetchCollectionSample(collection: string, limit = 12): Promise<DasItem[]> {
  const helius = getHeliusMainnetRpcUrl()
  if (!helius) throw new Error('HELIUS_API_KEY required')

  const res = await fetch(helius, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'nest-freeze-readiness',
      method: 'searchAssets',
      params: {
        grouping: ['collection', collection],
        page: 1,
        limit,
        burnt: false,
      },
    }),
  })
  const json = (await res.json()) as { result?: { items?: DasItem[] } }
  return json.result?.items ?? []
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--collection='))
  const collection = arg?.split('=')[1]?.trim() || getGen2CollectionMint()
  if (!collection) throw new Error('Pass --collection=<mint> or set NEXT_PUBLIC_GEN2_COLLECTION_MINT')

  const nestingAuthority = getNestingNftFreezeAuthorityWallet()
  if (!nestingAuthority) {
    console.warn('NESTING_NFT_FREEZE_AUTHORITY_WALLET not set — cannot compare nesting delegate.')
  } else {
    console.log(`Nesting freeze authority: ${nestingAuthority}`)
  }
  console.log(`Collection: ${collection}`)

  const connection = new Connection(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' })
  const items = await fetchCollectionSample(collection)
  console.log(`Sample size: ${items.length}`)

  let ready = 0
  let mintFrozen = 0
  let unsupported = 0
  let alreadyNested = 0

  for (const item of items) {
    const mint = item.id?.trim()
    const owner = item.ownership?.owner?.trim()
    if (!mint || !owner) continue

    let ownerIsWallet = true
    try {
      // Skip program-owned token accounts (off-curve) for this sample.
      PublicKey.isOnCurve(new PublicKey(owner).toBytes())
    } catch {
      ownerIsWallet = false
    }
    if (!ownerIsWallet) {
      console.log(`  ${mint.slice(0, 8)}… skip owner=${owner.slice(0, 6)}… (off-curve)`)
      continue
    }

    try {
      const { path, state } = await detectSplNestFreezePath({ mint, ownerWallet: owner, connection })
      let tag: string
      if (state.heldByNestingLock) {
        tag = 'already-nested'
        alreadyNested++
      } else if (state.isFrozen) {
        tag = 'mint-frozen'
        mintFrozen++
      } else if (path === 'freeze_delegated_account' || path === 'mint_freeze_authority') {
        tag = path === 'freeze_delegated_account' ? 'ready-tm-approve' : 'ready-mint-freeze'
        ready++
      } else {
        tag = 'unsupported'
        unsupported++
      }

      console.log(
        `  ${mint.slice(0, 8)}… owner=${owner.slice(0, 6)}… frozen=${state.isFrozen} ` +
          `delegate=${state.delegate?.slice(0, 8) ?? 'null'}… path=${path ?? 'null'} ${tag}`
      )
    } catch (e) {
      console.log(`  ${mint.slice(0, 8)}… ERR ${(e as Error).message?.slice(0, 100)}`)
      unsupported++
    }
  }

  console.log('')
  console.log(
    `Summary: ${ready} ready, ${alreadyNested} already nested, ${mintFrozen} still mint-frozen, ${unsupported} unsupported`
  )
  if (mintFrozen > 0) {
    console.log('→ Finish collection thaw before holders can nest.')
  }
  if (ready > 0) {
    console.log(
      '→ Gen 2 ready path: holder Approves nesting delegate (Ledger OK) → server FreezeDelegatedAccount.'
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
