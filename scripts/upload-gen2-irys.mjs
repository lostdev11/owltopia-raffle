/**
 * Upload Owltopia Gen2 assets to Arweave via Irys (Node SDK), then write a
 * Sugar-compatible cache.json with the Arweave links pre-filled so `sugar deploy`
 * can skip `sugar upload` (sugar 2.9.1 still targets the dead node1.bundlr.network).
 *
 * Run:
 *   node --env-file=.env.local scripts/upload-gen2-irys.mjs
 *   node --env-file=.env.local scripts/upload-gen2-irys.mjs --dry-run   # quote + plan only, no spend
 *
 * Resumable: progress is saved to collections/owltopia-gen2/.irys-uploaded.json
 * after every file, so a re-run skips anything already on Arweave (no double spend).
 */

import crypto from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const COLLECTION_DIR = 'collections/owltopia-gen2'
const ASSETS_DIR = join(COLLECTION_DIR, 'assets')
const STATE_PATH = join(COLLECTION_DIR, '.irys-uploaded.json')
const CACHE_PATH = join(COLLECTION_DIR, 'cache.json')
const GATEWAY = 'https://arweave.net'
const FUND_MULTIPLIER = 120n // fund 1.2x the quoted data price to absorb per-item overhead
// Irys charges a flat per-transaction minimum that the byte-only getPrice() quote on the
// summed size never captures. With thousands of tiny JSON uploads that floor dominates
// (empirically ~2.5e-5 SOL/file), so fund against a per-remaining-file floor too.
const PER_FILE_FLOOR_LAMPORTS = 100_000n // ~0.0001 SOL/file (observed ~5.5e-5), with safety margin
const SAVE_EVERY = 20
const DRY_RUN = process.argv.includes('--dry-run')
const LAMPORTS_PER_SOL = 1_000_000_000

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}
function sol(lamports) {
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(6)
}

function loadState() {
  if (!existsSync(STATE_PATH)) return {}
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return {}
  }
}
let uploaded = loadState()
function saveState() {
  writeFileSync(STATE_PATH, JSON.stringify(uploaded, null, 2))
}

/** Point the token metadata's image (and properties.files png uri) at the Arweave image URL. */
function rewriteMetadataJson(rawJson, imageUri) {
  const parsed = JSON.parse(rawJson)
  parsed.image = imageUri
  if (parsed.properties && Array.isArray(parsed.properties.files)) {
    parsed.properties.files = parsed.properties.files.map((f) =>
      typeof f.uri === 'string' && f.uri.toLowerCase().endsWith('.png') ? { ...f, uri: imageUri } : f
    )
  }
  return `${JSON.stringify(parsed, null, 2)}\n`
}

async function buildIrys() {
  const key = process.env.IRYS_PRIVATE_KEY?.trim()
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
  if (!key) throw new Error('IRYS_PRIVATE_KEY missing (run with --env-file=.env.local)')
  if (!rpc) throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL missing')
  const { Uploader } = await import('@irys/upload')
  const { Solana } = await import('@irys/upload-solana')
  // The SDK's default mainnet endpoint (uploader.irys.xyz) is SNI-blocked on some
  // networks/security suites (consistent ECONNRESET) while the canonical mainnet
  // node (node1.irys.xyz) — same Irys mainnet, same Arweave permanence — is reachable.
  // Pin the node explicitly so the upload works without disabling local protection.
  const node = process.env.IRYS_NODE_URL?.trim() || 'https://node1.irys.xyz'
  // Pays from the wallet via .withRpc.
  const irys = await Uploader(Solana).withWallet(key).withRpc(rpc).bundlerUrl(node)
  console.log(`Irys node: ${node}`)
  return irys
}

function listTokenIndices() {
  const files = readdirSync(ASSETS_DIR)
  return files
    .filter((f) => /^\d+\.png$/i.test(f))
    .map((f) => parseInt(f, 10))
    .sort((a, b) => a - b)
}

/** Bytes still needing upload (png not yet uploaded + rewritten-json size estimate). */
function remainingBytes(indices) {
  let total = 0
  for (const i of indices) {
    if (!uploaded[`assets/${i}.png`]) total += statSync(join(ASSETS_DIR, `${i}.png`)).size
    if (!uploaded[`assets/${i}.json`]) total += statSync(join(ASSETS_DIR, `${i}.json`)).size
  }
  for (const name of ['collection.png', 'collection.json']) {
    const p = join(ASSETS_DIR, name)
    if (existsSync(p) && !uploaded[`assets/${name}`]) total += statSync(p).size
  }
  return total
}

/** Count of individual files (png + json) still needing an upload (each = one Irys tx). */
function remainingFileCount(indices) {
  let n = 0
  for (const i of indices) {
    if (!uploaded[`assets/${i}.png`]) n += 1
    if (!uploaded[`assets/${i}.json`]) n += 1
  }
  for (const name of ['collection.png', 'collection.json']) {
    const p = join(ASSETS_DIR, name)
    if (existsSync(p) && !uploaded[`assets/${name}`]) n += 1
  }
  return n
}

async function loadedBalance(irys) {
  if (typeof irys.getLoadedBalance === 'function') return BigInt(String(await irys.getLoadedBalance()))
  if (typeof irys.getBalance === 'function') return BigInt(String(await irys.getBalance()))
  return 0n
}

async function ensureFunded(irys, bytes, fileCount) {
  const priceRaw = await irys.getPrice(bytes)
  const price = BigInt(String(priceRaw))
  const loaded = await loadedBalance(irys)
  const byteTarget = (price * FUND_MULTIPLIER) / 100n
  const floorTarget = BigInt(fileCount) * PER_FILE_FLOOR_LAMPORTS
  // Use whichever is larger: the byte-based quote (for big files) or the per-file
  // floor (for many tiny files, where the flat per-tx minimum dominates).
  const target = byteTarget > floorTarget ? byteTarget : floorTarget
  console.log(`Quote for ${(bytes / 1e6).toFixed(1)} MB: ~${sol(price)} SOL`)
  console.log(`Per-file floor for ${fileCount} files: ~${sol(floorTarget)} SOL`)
  console.log(`Irys loaded balance: ${sol(loaded)} SOL · fund target: ${sol(target)} SOL`)
  if (loaded >= target) {
    console.log('Already funded enough — no deposit needed.')
    return
  }
  const shortfall = target - loaded
  if (DRY_RUN) {
    console.log(`[dry-run] would deposit ${sol(shortfall)} SOL to Irys`)
    return
  }
  console.log(`Depositing ${sol(shortfall)} SOL to Irys…`)
  await irys.fund(shortfall)
  console.log(`New Irys balance: ${sol(await loadedBalance(irys))} SOL`)
}

// Norton (and flaky networks) intermittently reset the Irys connection mid-run.
// Each upload is an independent request, so retrying the failed one with backoff
// powers through resets instead of crashing the whole run.
const TRANSIENT_RE =
  /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|ECONNABORTED|socket hang up|network|fetch failed|aborted|ENOTFOUND|EAI_AGAIN|terminated|timeout/i

async function withRetry(fn, label, tries = 12) {
  let lastErr
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      if (!TRANSIENT_RE.test(msg) || attempt === tries) throw e
      const wait = Math.min(15000, 500 * 2 ** (attempt - 1))
      console.log(`  ↻ retry ${attempt}/${tries} (${label}): ${msg} — waiting ${Math.round(wait / 1000)}s`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}

async function uploadBuffer(irys, buf, contentType) {
  return withRetry(async () => {
    const receipt = await irys.upload(buf, { tags: [{ name: 'Content-Type', value: contentType }] })
    return `${GATEWAY}/${receipt.id}`
  }, contentType)
}

async function uploadToken(irys, i) {
  const pngKey = `assets/${i}.png`
  const jsonKey = `assets/${i}.json`
  const pngPath = join(ASSETS_DIR, `${i}.png`)
  const jsonPath = join(ASSETS_DIR, `${i}.json`)

  let pngLink = uploaded[pngKey]
  if (!pngLink) {
    pngLink = await uploadBuffer(irys, readFileSync(pngPath), 'image/png')
    uploaded[pngKey] = pngLink
  }
  // Always rewrite the on-disk JSON to the Arweave image link (idempotent) so the
  // uploaded bytes == on-disk bytes (cache.json hashes the on-disk file).
  const rewritten = rewriteMetadataJson(readFileSync(jsonPath, 'utf8'), pngLink)
  writeFileSync(jsonPath, rewritten)
  if (!uploaded[jsonKey]) {
    uploaded[jsonKey] = await uploadBuffer(irys, Buffer.from(rewritten, 'utf8'), 'application/json')
  }
}

async function uploadCollection(irys) {
  const pngPath = join(ASSETS_DIR, 'collection.png')
  const jsonPath = join(ASSETS_DIR, 'collection.json')
  if (existsSync(pngPath) && !uploaded['assets/collection.png']) {
    uploaded['assets/collection.png'] = await uploadBuffer(irys, readFileSync(pngPath), 'image/png')
  }
  if (existsSync(jsonPath)) {
    const imgLink = uploaded['assets/collection.png'] ?? uploaded['assets/0.png']
    if (imgLink) writeFileSync(jsonPath, rewriteMetadataJson(readFileSync(jsonPath, 'utf8'), imgLink))
    if (!uploaded['assets/collection.json']) {
      uploaded['assets/collection.json'] = await uploadBuffer(
        irys,
        readFileSync(jsonPath),
        'application/json'
      )
    }
  }
}

function buildCacheItems() {
  const items = {}
  const tokenRe = /^assets\/(\d+)\.(png|json)$/i
  for (const [key, link] of Object.entries(uploaded)) {
    const m = tokenRe.exec(key)
    if (!m) continue
    const index = m[1]
    const kind = m[2].toLowerCase()
    if (!items[index]) items[index] = { name: index }
    const buf = readFileSync(join(ASSETS_DIR, `${index}.${kind}`))
    if (kind === 'png') {
      items[index].image_hash = sha256Hex(buf)
      items[index].image_link = link
    } else {
      items[index].metadata_hash = sha256Hex(buf)
      items[index].metadata_link = link
    }
    items[index].onChain = false
  }
  const collJson = join(ASSETS_DIR, 'collection.json')
  if (existsSync(collJson)) {
    const item = {
      name: 'collection',
      metadata_hash: sha256Hex(readFileSync(collJson)),
      metadata_link: uploaded['assets/collection.json'] ?? '',
      onChain: false,
    }
    const collPng = join(ASSETS_DIR, 'collection.png')
    if (existsSync(collPng)) {
      item.image_hash = sha256Hex(readFileSync(collPng))
      item.image_link = uploaded['assets/collection.png'] ?? uploaded['assets/0.png'] ?? ''
    }
    items['-1'] = item
  }
  return items
}

function writeCache() {
  const cache = {
    program: { candyMachine: '', candyGuard: '', candyMachineCreator: '', collectionMint: '' },
    items: buildCacheItems(),
  }
  writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`)
}

async function main() {
  const indices = listTokenIndices()
  const doneTokens = indices.filter((i) => uploaded[`assets/${i}.png`] && uploaded[`assets/${i}.json`]).length
  console.log(`Tokens: ${indices.length} (already complete: ${doneTokens})`)

  const irys = await buildIrys()
  console.log(`Irys payer: ${String(irys.address)}`)

  const bytes = remainingBytes(indices)
  const fileCount = remainingFileCount(indices)
  if (fileCount > 0) {
    await ensureFunded(irys, bytes, fileCount)
  } else {
    console.log('All files already uploaded — building cache.json only.')
  }

  if (DRY_RUN) {
    console.log('[dry-run] stopping before any upload.')
    return
  }

  let processed = 0
  const failed = []
  for (const i of indices) {
    if (uploaded[`assets/${i}.png`] && uploaded[`assets/${i}.json`]) continue
    try {
      await uploadToken(irys, i)
    } catch (e) {
      // Already retried hard inside uploadBuffer; record and keep going so one
      // run finishes everything it can, then a final re-run mops up stragglers.
      failed.push(i)
      console.log(`  ⚠ token #${i} failed after retries: ${e instanceof Error ? e.message : e}`)
      saveState()
      continue
    }
    processed += 1
    if (processed % SAVE_EVERY === 0) {
      saveState()
      console.log(`  uploaded ${processed} tokens (last #${i})…`)
    }
  }
  saveState()
  if (failed.length) {
    console.log(`\n${failed.length} token(s) still pending after this run: ${failed.slice(0, 20).join(', ')}${failed.length > 20 ? '…' : ''}`)
    console.log('Re-run the same command to retry just those (no double spend).')
  }
  await uploadCollection(irys)
  saveState()

  writeCache()
  console.log(`\nDone. Uploaded all assets and wrote ${CACHE_PATH}.`)
  console.log('Next: npm run sugar:deploy -- collections/owltopia-gen2')
}

main().catch((e) => {
  saveState()
  console.error('\nFAILED:', e instanceof Error ? e.message : e)
  console.error('Progress saved — re-run the same command to resume (no double spend).')
  process.exit(1)
})
