/**
 * Read-only: sample Gen 2 (or any legacy TM) mints and report whether each mint's
 * freeze authority is assigned to the Owltopia nesting authority (required for SPL nest locks).
 *
 *   npx --yes tsx --env-file=.env.local scripts/inspect-nft-nest-freeze-readiness.ts
 *   npx --yes tsx --env-file=.env.local scripts/inspect-nft-nest-freeze-readiness.ts --collection=<mint>
 */
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { getNestingNftFreezeAuthorityWallet } from '@/lib/nesting/freeze-authority-keypair'
import { readSplTokenNestAccountState } from '@/lib/solana/spl-token-nest-lock'
import { getGen2CollectionMint } from '@/lib/solana/network'

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
    console.warn('NESTING_NFT_FREEZE_AUTHORITY_WALLET not set — cannot compare mint freeze authorities.')
  } else {
    console.log(`Nesting freeze authority: ${nestingAuthority}`)
  }
  console.log(`Collection: ${collection}`)

  const items = await fetchCollectionSample(collection)
  console.log(`Sample size: ${items.length}`)

  let ready = 0
  let mintFrozen = 0
  let missingAuthority = 0

  for (const item of items) {
    const mint = item.id?.trim()
    const owner = item.ownership?.owner?.trim()
    if (!mint || !owner) continue

    const state = await readSplTokenNestAccountState({ mint, ownerWallet: owner })
    const tag = state.nestingAuthorityCanFreeze
      ? 'ready'
      : state.isFrozen
        ? 'mint-frozen'
        : 'no-nesting-authority'

    if (state.nestingAuthorityCanFreeze) ready++
    else if (state.isFrozen) mintFrozen++
    else missingAuthority++

    console.log(
      `  ${mint.slice(0, 8)}… owner=${owner.slice(0, 6)}… frozen=${state.isFrozen} ` +
        `mintFreezeAuth=${state.mintFreezeAuthority?.slice(0, 8) ?? 'null'}… ${tag}`
    )
  }

  console.log('')
  console.log(`Summary: ${ready} ready, ${mintFrozen} still mint-frozen, ${missingAuthority} missing nesting freeze authority`)
  if (mintFrozen > 0) {
    console.log('→ Run gen2-freeze.ts thaw after mint-out before holders can nest.')
  }
  if (missingAuthority > 0) {
    console.log(
      '→ Partner / Gen 2 mints must assign each NFT mint freeze_authority to NESTING_NFT_FREEZE_AUTHORITY_WALLET before SPL nest locks work.'
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
