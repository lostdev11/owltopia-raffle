/**
 * Upload the new Owltopia Coin upgrade art to Arweave via Irys (Node SDK) and
 * write an upgrade manifest (coin number -> image/metadata Arweave URIs) for
 * scripts/seed-coin-upgrade-catalog.mjs.
 *
 * Input layout (same as the Gen2 uploader):
 *   collections/owltopia-coins-upgrade/assets/{n}.png   — new art for coin #n
 *   collections/owltopia-coins-upgrade/assets/{n}.json  — new metadata for coin #n
 *
 * Run:
 *   node --env-file=.env.local scripts/upload-coin-upgrade-irys.mjs
 *   node --env-file=.env.local scripts/upload-coin-upgrade-irys.mjs --dry-run   # quote + plan only, no spend
 *
 * Resumable: progress is saved to collections/owltopia-coins-upgrade/.irys-uploaded.json
 * after every file, so a re-run skips anything already on Arweave (no double spend).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const COLLECTION_DIR = 'collections/owltopia-coins-upgrade'
const ASSETS_DIR = join(COLLECTION_DIR, 'assets')
const STATE_PATH = join(COLLECTION_DIR, '.irys-uploaded.json')
const MANIFEST_PATH = join(COLLECTION_DIR, 'upgrade-manifest.json')
const GATEWAY = 'https://arweave.net'
const FUND_MULTIPLIER = 120n // fund 1.2x the quoted data price to absorb per-item overhead
// Irys charges a flat per-transaction minimum that the byte-only getPrice() quote never
// captures; with many small JSON files that floor dominates (see upload-gen2-irys.mjs).
const PER_FILE_FLOOR_LAMPORTS = 100_000n
const SAVE_EVERY = 20
const DRY_RUN = process.argv.includes('--dry-run')
const LAMPORTS_PER_SOL = 1_000_000_000

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

/** Point the metadata's image (and properties.files png uri) at the Arweave image URL. */
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
  const node = process.env.IRYS_NODE_URL?.trim() || 'https://node1.irys.xyz'
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

function remainingBytes(indices) {
  let total = 0
  for (const i of indices) {
    if (!uploaded[`assets/${i}.png`]) total += statSync(join(ASSETS_DIR, `${i}.png`)).size
    if (!uploaded[`assets/${i}.json`]) total += statSync(join(ASSETS_DIR, `${i}.json`)).size
  }
  return total
}

function remainingFileCount(indices) {
  let n = 0
  for (const i of indices) {
    if (!uploaded[`assets/${i}.png`]) n += 1
    if (!uploaded[`assets/${i}.json`]) n += 1
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
  const rewritten = rewriteMetadataJson(readFileSync(jsonPath, 'utf8'), pngLink)
  writeFileSync(jsonPath, rewritten)
  if (!uploaded[jsonKey]) {
    uploaded[jsonKey] = await uploadBuffer(irys, Buffer.from(rewritten, 'utf8'), 'application/json')
  }
}

/** coin number -> { image, metadata } Arweave URIs (input for the catalog seeder). */
function writeManifest(indices) {
  const items = {}
  for (const i of indices) {
    const image = uploaded[`assets/${i}.png`]
    const metadata = uploaded[`assets/${i}.json`]
    if (image && metadata) items[i] = { image, metadata }
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(items, null, 2)}\n`)
  return Object.keys(items).length
}

async function main() {
  if (!existsSync(ASSETS_DIR)) {
    throw new Error(
      `${ASSETS_DIR} not found. Place the new coin art as {n}.png + {n}.json (n = coin number) and re-run.`
    )
  }
  const indices = listTokenIndices()
  const done = indices.filter((i) => uploaded[`assets/${i}.png`] && uploaded[`assets/${i}.json`]).length
  console.log(`Coins: ${indices.length} (already complete: ${done})`)

  const irys = await buildIrys()
  console.log(`Irys payer: ${String(irys.address)}`)

  const bytes = remainingBytes(indices)
  const fileCount = remainingFileCount(indices)
  if (fileCount > 0) {
    await ensureFunded(irys, bytes, fileCount)
  } else {
    console.log('All files already uploaded — writing manifest only.')
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
      failed.push(i)
      console.log(`  ⚠ coin #${i} failed after retries: ${e instanceof Error ? e.message : e}`)
      saveState()
      continue
    }
    processed += 1
    if (processed % SAVE_EVERY === 0) {
      saveState()
      console.log(`  uploaded ${processed} coins (last #${i})…`)
    }
  }
  saveState()
  if (failed.length) {
    console.log(`\n${failed.length} coin(s) still pending after this run: ${failed.slice(0, 20).join(', ')}${failed.length > 20 ? '…' : ''}`)
    console.log('Re-run the same command to retry just those (no double spend).')
  }

  const manifestCount = writeManifest(indices)
  console.log(`\nDone. Wrote ${MANIFEST_PATH} with ${manifestCount} coins.`)
  console.log('Next: node --env-file=.env.local scripts/seed-coin-upgrade-catalog.mjs --dry-run')
}

main().catch((e) => {
  saveState()
  console.error('\nFAILED:', e instanceof Error ? e.message : e)
  console.error('Progress saved — re-run the same command to resume (no double spend).')
  process.exit(1)
})
