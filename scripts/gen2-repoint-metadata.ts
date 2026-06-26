/**
 * Phase 3 — repoint the on-chain Gen2 metadata to the permanent mainnet Arweave links.
 *
 * Phase 2 (scripts/upload-gen2-irys.mjs) re-uploaded the art + metadata to PERMANENT mainnet
 * Arweave and wrote a fresh collections/owltopia-gen2/cache.json with new https://arweave.net/<id>
 * links. This script rewrites every candy-machine config-line URI to the new link and updates the
 * collection NFT, so wallets / Helius DAS resolve name + image + traits. The art is unchanged; only
 * the URI moves off the dead devnet links onto permanent Arweave.
 *
 * Mapping is BY INDEX: the re-upload read the same assets/ dir in the same order, so cache index i
 * == config-line index i == the same art. The OLD cache (cache.devnet.old.json) is used only to
 * sanity-check that on-chain line i still equals old cache[i] before we touch it.
 *
 * Config-line NAMES are preserved exactly (addConfigLines writes name+uri together) — we only swap
 * the URI. itemsRedeemed (the 2 test mints) keep their dead URI on the minted NFT (their config line
 * is still repointed for completeness); fix those 2 separately if needed.
 *
 * Safe by default (prints the plan + validates everything). Pass --confirm to send.
 *   npx --yes tsx --env-file=.env.local scripts/gen2-repoint-metadata.ts lines
 *   npx --yes tsx --env-file=.env.local scripts/gen2-repoint-metadata.ts lines --confirm
 *   npx --yes tsx --env-file=.env.local scripts/gen2-repoint-metadata.ts collection --confirm
 *   npx --yes tsx --env-file=.env.local scripts/gen2-repoint-metadata.ts all --confirm
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import bs58 from 'bs58'
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
  some,
  type Umi,
} from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine, addConfigLines } from '@metaplex-foundation/mpl-candy-machine'
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
  updateV1,
} from '@metaplex-foundation/mpl-token-metadata'

const COLLECTION_DIR = 'collections/owltopia-gen2'
const CACHE_PATH = join(COLLECTION_DIR, 'cache.json')
const OLD_CACHE_PATH = join(COLLECTION_DIR, 'cache.devnet.old.json')

const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const COLLECTION_NAME = 'Owltopia G2'
const COLLECTION_SYMBOL = 'OWL2'
const ROYALTY_PERCENT = 10

const BATCH = 8 // config lines per addConfigLines tx (name<=4 + uri<=63 each; stays under tx size)

type CacheItem = {
  name?: string
  image_hash?: string
  image_link?: string
  metadata_hash?: string
  metadata_link?: string
  onChain?: boolean
}
type Cache = { program?: Record<string, string>; items: Record<string, CacheItem> }

function loadCache(path: string): Cache {
  if (!existsSync(path)) throw new Error(`cache not found: ${path}`)
  const c = JSON.parse(readFileSync(path, 'utf8')) as Cache
  if (!c.items) throw new Error(`cache has no items: ${path}`)
  return c
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

async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      if (attempt === tries) break
      const wait = Math.min(15000, 800 * 2 ** (attempt - 1))
      console.log(`  ↻ retry ${attempt}/${tries} (${label}): ${msg} — waiting ${Math.round(wait / 1000)}s`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function repointLines(confirm: boolean) {
  const umi = loadAuthorityUmi()
  const cmPk = publicKey(CM_ID)
  const cm = await fetchCandyMachine(umi, cmPk)

  if (String(cm.authority) !== String(umi.identity.publicKey)) {
    throw new Error(`Configured key ${umi.identity.publicKey} is not the CM authority ${cm.authority}.`)
  }

  const settings = cm.data.configLineSettings
  const prefixUri = (settings.__option === 'Some' ? settings.value.prefixUri : '') || ''
  const uriLength = settings.__option === 'Some' ? settings.value.uriLength : 200

  const cache = loadCache(CACHE_PATH)
  const oldCache = existsSync(OLD_CACHE_PATH) ? loadCache(OLD_CACHE_PATH) : null

  const items = [...cm.items].sort((a, b) => a.index - b.index)
  console.log(`CM ${CM_ID}`)
  console.log(`  authority ok · itemsLoaded=${cm.itemsLoaded} itemsRedeemed=${cm.itemsRedeemed}`)
  console.log(`  configLineSettings: prefixUri="${prefixUri}" uriLength=${uriLength}`)

  type Plan = { index: number; name: string; newStored: string; oldFull: string; newFull: string }
  const toUpdate: Plan[] = []
  let alreadyOk = 0
  let oldMismatch = 0
  const missing: number[] = []
  const tooLong: number[] = []

  for (const item of items) {
    const ci = cache.items[String(item.index)]
    if (!ci?.metadata_link) {
      missing.push(item.index)
      continue
    }
    const newFull = ci.metadata_link
    // Stored value = full uri minus the on-chain prefix (prefix is empty here -> full).
    const newStored = prefixUri && newFull.startsWith(prefixUri) ? newFull.slice(prefixUri.length) : newFull
    if (newStored.length > uriLength) {
      tooLong.push(item.index)
      continue
    }
    // The SDK reconstructs item.uri as the FULL uri (prefix already prepended on read),
    // so do NOT prepend prefixUri again here.
    const onChainFull = item.uri
    if (oldCache) {
      const oldLink = oldCache.items[String(item.index)]?.metadata_link
      if (oldLink && oldLink !== onChainFull) oldMismatch += 1
    }
    if (onChainFull === newFull) {
      alreadyOk += 1
      continue
    }
    toUpdate.push({ index: item.index, name: item.name, newStored, oldFull: onChainFull, newFull })
  }

  console.log(`\nplan:`)
  console.log(`  lines on chain:      ${items.length}`)
  console.log(`  already correct:     ${alreadyOk}`)
  console.log(`  to repoint:          ${toUpdate.length}`)
  console.log(`  missing in new cache:${missing.length}${missing.length ? ` (e.g. ${missing.slice(0, 8).join(', ')})` : ''}`)
  console.log(`  uri too long (>${uriLength}): ${tooLong.length}${tooLong.length ? ` (e.g. ${tooLong.slice(0, 8).join(', ')})` : ''}`)
  if (oldCache) console.log(`  on-chain != old cache: ${oldMismatch} (expected ~0 if untouched since deploy)`)
  for (const p of toUpdate.slice(0, 3)) {
    console.log(`   #${p.index} name="${p.name}"`)
    console.log(`      ${p.oldFull}`)
    console.log(`   -> ${p.newFull}`)
  }

  if (missing.length || tooLong.length) {
    throw new Error('Refusing: some lines are missing in the new cache or exceed uriLength. Fix before --confirm.')
  }
  if (toUpdate.length === 0) {
    console.log('\nNothing to repoint — all config lines already point at the new links.')
    return
  }
  if (!confirm) {
    console.log('\n(dry-run) re-run with --confirm to send.')
    return
  }

  // addConfigLines writes a CONTIGUOUS run starting at `index`. Build contiguous chunks.
  let sent = 0
  for (let i = 0; i < toUpdate.length; ) {
    const chunk: Plan[] = [toUpdate[i]!]
    let j = i + 1
    while (j < toUpdate.length && chunk.length < BATCH && toUpdate[j]!.index === chunk[chunk.length - 1]!.index + 1) {
      chunk.push(toUpdate[j]!)
      j += 1
    }
    const start = chunk[0]!.index
    await withRetry(
      () =>
        addConfigLines(umi, {
          candyMachine: cmPk,
          index: start,
          configLines: chunk.map((c) => ({ name: c.name, uri: c.newStored })),
        }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } }),
      `addConfigLines @${start}`
    )
    sent += chunk.length
    if (sent % 80 === 0 || j >= toUpdate.length) console.log(`  repointed ${sent}/${toUpdate.length} (last #${chunk[chunk.length - 1]!.index})`)
    i = j
  }
  console.log(`\nDone. Repointed ${sent} config lines.`)
}

async function updateCollection(confirm: boolean) {
  const umi = loadAuthorityUmi()
  const cmPk = publicKey(CM_ID)
  const cm = await fetchCandyMachine(umi, cmPk)
  const collMint = cm.collectionMint

  const cache = loadCache(CACHE_PATH)
  const coll = cache.items['-1']
  if (!coll?.metadata_link) throw new Error('new cache has no collection ("-1") metadata_link')
  const newUri = coll.metadata_link

  const md = await fetchMetadataFromSeeds(umi, { mint: collMint })
  if (String(md.updateAuthority) !== String(umi.identity.publicKey)) {
    throw new Error(`Configured key ${umi.identity.publicKey} is not the collection update authority ${md.updateAuthority}.`)
  }

  console.log(`collection mint ${collMint}`)
  console.log(`  name:   "${md.name}" -> "${COLLECTION_NAME}"`)
  console.log(`  symbol: "${md.symbol}" -> "${COLLECTION_SYMBOL}"`)
  console.log(`  uri:    ${md.uri}`)
  console.log(`       -> ${newUri}`)

  if (!confirm) {
    console.log('\n(dry-run) re-run with --confirm to send.')
    return
  }

  await withRetry(
    () =>
      updateV1(umi, {
        mint: collMint,
        authority: umi.identity,
        data: some({
          name: COLLECTION_NAME,
          symbol: COLLECTION_SYMBOL,
          uri: newUri,
          sellerFeeBasisPoints: ROYALTY_PERCENT * 100,
          creators: md.creators,
        }),
      }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } }),
    'updateCollection'
  )
  console.log('Done. Collection NFT updated.')
}

async function main() {
  const cmd = process.argv[2]
  const confirm = process.argv.includes('--confirm')
  if (cmd === 'lines') return repointLines(confirm)
  if (cmd === 'collection') return updateCollection(confirm)
  if (cmd === 'all') {
    await repointLines(confirm)
    await updateCollection(confirm)
    return
  }
  console.log('usage: gen2-repoint-metadata.ts <lines|collection|all> [--confirm]')
  process.exit(1)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('repoint failed:', e)
    process.exit(1)
  })
