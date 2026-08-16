/**
 * Seed the coin_art_upgrade_catalog table: map every Owltopia coin asset id to
 * its new Arweave art URI from the Irys upload manifest.
 *
 * Inputs:
 *   - collections/owltopia-coins-upgrade/upgrade-manifest.json
 *     (written by scripts/upload-coin-upgrade-irys.mjs: coin number -> { image, metadata })
 *   - Helius DAS getAssetsByGroup over the coin collection (asset id, name, current URI)
 *
 * Coin numbers are read from the on-chain asset name (e.g. "Owltopia Coin #123").
 *
 * Run:
 *   node --env-file=.env.local scripts/seed-coin-upgrade-catalog.mjs --dry-run
 *   node --env-file=.env.local scripts/seed-coin-upgrade-catalog.mjs
 *   node --env-file=.env.local scripts/seed-coin-upgrade-catalog.mjs --collection <pubkey>
 *
 * Env: HELIUS_API_KEY, NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const MANIFEST_PATH = join('collections/owltopia-coins-upgrade', 'upgrade-manifest.json')
const DEFAULT_COLLECTION = 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB'
const DRY_RUN = process.argv.includes('--dry-run')
const PAGE_SIZE = 1000

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].trim() : null
}

function heliusUrl() {
  const key = process.env.HELIUS_API_KEY?.trim()
  if (!key) throw new Error('HELIUS_API_KEY missing (run with --env-file=.env.local)')
  return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

async function fetchCollectionAssets(collection) {
  const url = heliusUrl()
  const assets = []
  for (let page = 1; ; page += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'seed-coin-upgrade-catalog',
        method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collection, page, limit: PAGE_SIZE },
      }),
    })
    if (!res.ok) throw new Error(`Helius getAssetsByGroup failed (status ${res.status})`)
    const json = await res.json()
    if (json.error) throw new Error(`Helius error: ${json.error.message ?? JSON.stringify(json.error)}`)
    const items = json.result?.items ?? []
    assets.push(...items)
    console.log(`  page ${page}: ${items.length} assets (total ${assets.length})`)
    if (items.length < PAGE_SIZE) break
  }
  return assets
}

function coinNumberFromName(name) {
  const m = /#\s*(\d+)/.exec(name ?? '')
  if (m) return parseInt(m[1], 10)
  const tail = /(\d+)\s*$/.exec(name ?? '')
  return tail ? parseInt(tail[1], 10) : null
}

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`${MANIFEST_PATH} not found — run scripts/upload-coin-upgrade-irys.mjs first.`)
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const manifestCount = Object.keys(manifest).length
  console.log(`Manifest: ${manifestCount} coins with uploaded art`)

  const collection = argValue('--collection') || DEFAULT_COLLECTION
  console.log(`Fetching assets in collection ${collection}…`)
  const assets = await fetchCollectionAssets(collection)
  console.log(`Fetched ${assets.length} on-chain assets`)

  const rows = []
  const problems = { noNumber: [], noArt: [], duplicateNumber: [] }
  const seenNumbers = new Map()
  for (const asset of assets) {
    if (asset.burnt === true) continue
    const assetId = asset.id?.trim()
    if (!assetId) continue
    const name = asset.content?.metadata?.name ?? null
    const n = coinNumberFromName(name)
    if (n == null) {
      problems.noNumber.push({ assetId, name })
      continue
    }
    if (seenNumbers.has(n)) {
      problems.duplicateNumber.push({ n, assetId, other: seenNumbers.get(n) })
      continue
    }
    seenNumbers.set(n, assetId)
    const art = manifest[String(n)]
    if (!art?.metadata) {
      problems.noArt.push({ n, assetId })
      continue
    }
    rows.push({
      asset_id: assetId,
      coin_number: n,
      name,
      new_uri: art.metadata,
      new_image_uri: art.image ?? null,
      original_uri: asset.content?.json_uri ?? null,
    })
  }

  console.log(`\nCatalog rows ready: ${rows.length}`)
  if (problems.noNumber.length) {
    console.log(`⚠ ${problems.noNumber.length} asset(s) without a coin number in the name (skipped):`)
    for (const p of problems.noNumber.slice(0, 10)) console.log(`   ${p.assetId} — "${p.name}"`)
  }
  if (problems.duplicateNumber.length) {
    console.log(`⚠ ${problems.duplicateNumber.length} duplicate coin number(s) (skipped):`)
    for (const p of problems.duplicateNumber.slice(0, 10)) console.log(`   #${p.n}: ${p.assetId} vs ${p.other}`)
  }
  if (problems.noArt.length) {
    console.log(`⚠ ${problems.noArt.length} coin(s) without uploaded art in the manifest (skipped):`)
    for (const p of problems.noArt.slice(0, 10)) console.log(`   #${p.n} (${p.assetId})`)
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] not writing to Supabase. Sample row:')
    console.log(JSON.stringify(rows[0] ?? null, null, 2))
    return
  }

  const db = supabaseAdmin()
  const CHUNK = 500
  let upserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await db.from('coin_art_upgrade_catalog').upsert(chunk, { onConflict: 'asset_id' })
    if (error) throw new Error(`Supabase upsert failed at chunk ${i / CHUNK}: ${error.message}`)
    upserted += chunk.length
    console.log(`  upserted ${upserted}/${rows.length}`)
  }
  console.log(`\nDone. Catalog seeded with ${upserted} coins.`)
  console.log('Flip COIN_ART_UPGRADE_ENABLED=true (plus authority + fee env) to open upgrades.')
}

main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
