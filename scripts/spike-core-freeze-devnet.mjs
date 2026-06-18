/**
 * Phase 3 SPIKE — Metaplex Core "Freeze Collection" on devnet.
 *
 * Uses ONLY @metaplex-foundation/mpl-core (already installed) — no candy machine needed.
 * The freeze is enforced by the COLLECTION-level PermanentFreezeDelegate plugin; how an asset
 * is minted (candy machine vs direct `create`) is irrelevant to the freeze, since any collection
 * member inherits the collection-level freeze. This validates the founder-controlled freeze/thaw.
 *
 * Validates:
 *   1. Create a Core Collection WITH a collection-level PermanentFreezeDelegate (frozen: true),
 *      authority = our freeze-authority address (thaw-able later — NOT `None`, which = permanent soulbound).
 *   2. Create an asset INTO that collection.
 *   3. Assert the asset is FROZEN (transfer must fail).
 *   4. THAW the whole collection in ONE tx (updateCollectionPluginV1 -> frozen: false).
 *   5. Assert the asset is now transferable.
 *
 * Run:
 *   node scripts/spike-core-freeze-devnet.mjs
 *
 * Optional env:
 *   SPIKE_DEVNET_RPC_URL   - devnet RPC (defaults to api.devnet.solana.com)
 *   SPIKE_PAYER_SECRET_KEY - bs58 or JSON array secret key (defaults to an ephemeral airdropped key)
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { generateSigner, keypairIdentity, sol } from '@metaplex-foundation/umi'
import {
  create,
  createCollection,
  fetchAsset,
  fetchCollection,
  transferV1,
  updateCollectionPlugin,
  mplCore,
} from '@metaplex-foundation/mpl-core'
import bs58 from 'bs58'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** Repo convention (see scripts/mint-devnet-nft.mjs): a funded devnet keypair JSON array. */
const KEYPAIR_FILE = path.join(__dirname, 'phantom-devnet-keypair.json')

const RPC =
  process.env.SPIKE_DEVNET_RPC_URL?.trim() ||
  process.env.SOLANA_RPC_URL?.trim() ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
  'https://api.devnet.solana.com'
const DUMMY_URI = 'https://example.com/metadata.json'

function log(step, msg) {
  console.log(`${step} ${msg}`)
}

function keypairFromRaw(umi, raw, source) {
  try {
    const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw)
    return umi.eddsa.createKeypairFromSecretKey(bytes)
  } catch (e) {
    throw new Error(`Bad key from ${source}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function loadPayer(umi) {
  const env = process.env.SPIKE_PAYER_SECRET_KEY?.trim()
  if (env) return { kp: keypairFromRaw(umi, env, 'SPIKE_PAYER_SECRET_KEY'), source: 'env' }
  if (existsSync(KEYPAIR_FILE)) {
    return { kp: keypairFromRaw(umi, readFileSync(KEYPAIR_FILE, 'utf8').trim(), KEYPAIR_FILE), source: 'file' }
  }
  return null
}

async function ensureFunds(umi) {
  const needed = sol(0.5).basisPoints
  const have = await umi.rpc.getBalance(umi.identity.publicKey)
  if (have.basisPoints >= needed) {
    log('💰', `Payer already funded: ${Number(have.basisPoints) / 1e9} SOL`)
    return
  }

  const ATTEMPTS = 6
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    log('💧', `Requesting devnet airdrop (1 SOL) — attempt ${attempt}/${ATTEMPTS}…`)
    try {
      await umi.rpc.airdrop(umi.identity.publicKey, sol(1))
    } catch (e) {
      log('⚠️', `Airdrop call failed: ${shortErr(e)}`)
      await new Promise((r) => setTimeout(r, 3000 * attempt))
      continue
    }
    for (let i = 0; i < 12; i += 1) {
      const bal = await umi.rpc.getBalance(umi.identity.publicKey)
      if (bal.basisPoints >= needed) {
        log('💰', `Funded: ${Number(bal.basisPoints) / 1e9} SOL`)
        return
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw new Error(
    'Devnet faucet kept rejecting the airdrop (common from datacenter IPs / rate limits). ' +
      'Run with SPIKE_PAYER_SECRET_KEY set to a funded devnet key, or SPIKE_DEVNET_RPC_URL set to a private devnet RPC (e.g. Helius).'
  )
}

function shortErr(e) {
  return (e instanceof Error ? e.message : String(e)).split('\n')[0]
}

/** JSON.stringify that survives BigInt (mpl-core plugin fields can be BigInt). */
function j(obj) {
  return JSON.stringify(obj ?? null, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

/**
 * Public devnet RPC is load-balanced, so a read right after a confirmed write can hit a node
 * that hasn't caught up yet (AccountNotFoundError). Retry the read until it appears.
 */
async function readWithRetry(label, fn, attempts = 10, delayMs = 1500) {
  let last
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const msg = shortErr(e)
      if (!/not found|AccountNotFound/i.test(msg)) throw e
      if (i < attempts) {
        log('⏳', `${label} not visible yet (RPC lag) — retry ${i}/${attempts}…`)
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }
  throw last
}

async function main() {
  log('🔧', `RPC: ${RPC}`)
  const umi = createUmi(RPC).use(mplCore())

  const loaded = loadPayer(umi)
  const payer = loaded ? loaded.kp : umi.eddsa.generateKeypair()
  umi.use(keypairIdentity(payer))
  log('🔑', `Payer / freeze authority: ${payer.publicKey}${loaded ? ` (from ${loaded.source})` : ' (ephemeral)'}`)

  await ensureFunds(umi)

  // 1) Core collection WITH collection-level PermanentFreezeDelegate (thaw-able authority).
  const collection = generateSigner(umi)
  log('📦', `Creating Core collection ${collection.publicKey} (frozen, authority = payer)…`)
  await createCollection(umi, {
    collection,
    name: 'Spike Freeze Collection',
    uri: DUMMY_URI,
    plugins: [
      {
        type: 'PermanentFreezeDelegate',
        frozen: true,
        authority: { type: 'Address', address: payer.publicKey },
      },
    ],
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

  const colAtCreate = await readWithRetry('collection', () => fetchCollection(umi, collection.publicKey))
  log('✅', `Collection PermanentFreezeDelegate at create: ${j(colAtCreate.permanentFreezeDelegate)}`)

  // 2) Create an asset INTO the collection (stands in for a candy-machine mint).
  const asset = generateSigner(umi)
  log('🪙', `Creating asset ${asset.publicKey} into the frozen collection…`)
  await create(umi, {
    asset,
    collection: colAtCreate,
    name: 'Spike Asset #1',
    uri: DUMMY_URI,
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

  // Make sure the asset is visible on the read nodes before testing transfers (avoids false positives).
  await readWithRetry('asset (pre-transfer)', () => fetchAsset(umi, asset.publicKey))

  // 3) Prove it is frozen — a transfer must FAIL with a freeze rejection (not RPC lag).
  const recipient = generateSigner(umi).publicKey
  let frozenBlocked = false
  try {
    await transferV1(umi, {
      asset: asset.publicKey,
      collection: collection.publicKey,
      newOwner: recipient,
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  } catch (e) {
    const msg = shortErr(e)
    if (/not found|AccountNotFound/i.test(msg)) {
      throw new Error(`Inconclusive — transfer failed due to RPC lag, not freeze: ${msg}`)
    }
    frozenBlocked = true
    log('🧊', `Transfer correctly REJECTED while frozen: ${msg}`)
  }
  if (!frozenBlocked) throw new Error('FREEZE FAILED — transfer succeeded while the collection should be frozen.')

  // 4) Thaw the WHOLE collection in one tx.
  log('🔥', 'Thawing entire collection in a single tx (frozen -> false)…')
  await updateCollectionPlugin(umi, {
    collection: collection.publicKey,
    plugin: { type: 'PermanentFreezeDelegate', frozen: false },
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

  const colAfterThaw = await readWithRetry('collection (post-thaw)', () => fetchCollection(umi, collection.publicKey))
  log('✅', `Collection PermanentFreezeDelegate after thaw: ${j(colAfterThaw.permanentFreezeDelegate)}`)

  // 5) Prove it is now transferable.
  await transferV1(umi, {
    asset: asset.publicKey,
    collection: collection.publicKey,
    newOwner: recipient,
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  const moved = await readWithRetry('asset', () => fetchAsset(umi, asset.publicKey))
  log('🎉', `Transfer SUCCEEDED after thaw. New owner: ${moved.owner}`)

  console.log('\n=== SPIKE RESULT ===')
  console.log('collection :', String(collection.publicKey))
  console.log('asset      :', String(asset.publicKey))
  console.log('freeze@mint :', frozenBlocked ? 'FROZEN (transfer blocked) ✅' : 'NOT frozen ❌')
  console.log('thaw (1 tx) :', String(moved.owner) === String(recipient) ? 'THAWED + transferable ✅' : 'thaw failed ❌')
  console.log('VERDICT     : Collection-level PermanentFreezeDelegate works — founder-controlled, no 30-day cap.')
}

main().catch((e) => {
  console.error('\n❌ SPIKE FAILED:', e instanceof Error ? e.stack : e)
  process.exit(1)
})
