/**
 * Fix already-minted Gen2 test NFTs. Config-line repointing only affects FUTURE mints,
 * so any NFT minted before the repoint still carries its old (dead) URI + old name/symbol.
 * This finds every minted asset in the collection and rewrites each one to the new
 * permanent Arweave link + "Owltopia G2 #N" / "OWL2".
 *
 * Mapping: the minted NFT's on-chain name is the config-line name = the index ("0".."1999").
 * The JSON at that index is named "#(index+1)", so the NFT name becomes "Owltopia G2 #(index+1)"
 * and the URI becomes cache.items[index].metadata_link.
 *
 *   npx --yes tsx --env-file=.env.local scripts/gen2-fix-test-mints.ts           # dry-run
 *   npx --yes tsx --env-file=.env.local scripts/gen2-fix-test-mints.ts --confirm
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import bs58 from 'bs58'
import { createSignerFromKeypair, publicKey, signerIdentity, some, type Umi } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine } from '@metaplex-foundation/mpl-candy-machine'
import { fetchMetadataFromSeeds, mplTokenMetadata, updateV1 } from '@metaplex-foundation/mpl-token-metadata'

const COLLECTION_DIR = 'collections/owltopia-gen2'
const CACHE_PATH = join(COLLECTION_DIR, 'cache.json')
const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const NEW_NAME_PREFIX = 'Owltopia G2 #'
const NEW_SYMBOL = 'OWL2'
const ROYALTY_PERCENT = 10

type CacheItem = { metadata_link?: string }
type Cache = { items: Record<string, CacheItem> }

function loadCache(): Cache {
  if (!existsSync(CACHE_PATH)) throw new Error(`cache not found: ${CACHE_PATH}`)
  return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Cache
}

function loadAuthorityUmi(): Umi {
  const raw = process.env.GEN2_GUARD_AUTHORITY_SECRET_KEY?.trim() || process.env.IRYS_PRIVATE_KEY?.trim()
  if (!raw) throw new Error('GEN2_GUARD_AUTHORITY_SECRET_KEY (or IRYS_PRIVATE_KEY) not set')
  let secret: Uint8Array
  try {
    secret = bs58.decode(raw)
  } catch {
    secret = Uint8Array.from(JSON.parse(raw) as number[])
  }
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplCandyMachine()).use(mplTokenMetadata())
  const kp = umi.eddsa.createKeypairFromSecretKey(secret)
  umi.use(signerIdentity(createSignerFromKeypair(umi, kp)))
  return umi
}

async function dasGetAssetsByGroup(collectionMint: string): Promise<string[]> {
  const ids: string[] = []
  let page = 1
  for (;;) {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'das',
        method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collectionMint, page, limit: 1000 },
      }),
    })
    const j = await res.json()
    if (j.error) throw new Error(`DAS error: ${JSON.stringify(j.error)}`)
    const items = j.result?.items ?? []
    for (const it of items) ids.push(it.id)
    if (items.length < 1000) break
    page += 1
  }
  return ids
}

async function main() {
  const confirm = process.argv.includes('--confirm')
  const umi = loadAuthorityUmi()
  const cache = loadCache()

  const cm = await fetchCandyMachine(umi, publicKey(CM_ID))
  const collectionMint = String(cm.collectionMint)
  console.log(`collection ${collectionMint} · itemsRedeemed=${cm.itemsRedeemed}`)

  const mints = await dasGetAssetsByGroup(collectionMint)
  // The collection NFT itself can show up in the group; drop it.
  const minted = mints.filter((m) => m !== collectionMint)
  console.log(`found ${minted.length} minted asset(s) in collection`)

  type Plan = { mint: string; index: number; oldName: string; newName: string; oldUri: string; newUri: string }
  const plans: Plan[] = []
  for (const mint of minted) {
    const md = await fetchMetadataFromSeeds(umi, { mint: publicKey(mint) })
    if (String(md.updateAuthority) !== String(umi.identity.publicKey)) {
      console.log(`  ! ${mint}: update authority ${md.updateAuthority} != our key — skipping`)
      continue
    }
    const index = parseInt(md.name.trim(), 10)
    if (Number.isNaN(index)) {
      console.log(`  ! ${mint}: on-chain name "${md.name}" is not an index — skipping`)
      continue
    }
    const newUri = cache.items[String(index)]?.metadata_link
    if (!newUri) {
      console.log(`  ! ${mint}: no cache link for index ${index} — skipping`)
      continue
    }
    plans.push({
      mint,
      index,
      oldName: md.name,
      newName: `${NEW_NAME_PREFIX}${index + 1}`,
      oldUri: md.uri,
      newUri,
    })
  }

  console.log(`\nplan (${plans.length}):`)
  for (const p of plans) {
    console.log(`  ${p.mint} idx=${p.index}`)
    console.log(`    name: "${p.oldName}" -> "${p.newName}" · symbol -> "${NEW_SYMBOL}"`)
    console.log(`    uri:  ${p.oldUri}`)
    console.log(`       -> ${p.newUri}`)
  }

  if (!confirm) {
    console.log('\n(dry-run) re-run with --confirm to send.')
    return
  }

  for (const p of plans) {
    const md = await fetchMetadataFromSeeds(umi, { mint: publicKey(p.mint) })
    await updateV1(umi, {
      mint: publicKey(p.mint),
      authority: umi.identity,
      data: some({
        name: p.newName,
        symbol: NEW_SYMBOL,
        uri: p.newUri,
        sellerFeeBasisPoints: ROYALTY_PERCENT * 100,
        creators: md.creators,
      }),
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    console.log(`  updated ${p.mint} -> ${p.newName}`)
  }
  console.log('\nDone. Fixed minted test NFTs.')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('fix failed:', e)
    process.exit(1)
  })
