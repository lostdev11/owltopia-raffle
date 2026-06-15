#!/usr/bin/env node
/**
 * Read Sugar cache.json after deploy and sync CM + collection mint into Owl Center (Supabase).
 * Optionally auto-promotes launch to PUBLIC when metadata is ready.
 *
 * Usage:
 *   npm run sugar:sync-ids -- collections/papers
 *   npm run sugar:sync-ids -- --launch-id=UUID
 *   npm run sugar:sync-ids -- collections/papers --no-go-live
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_HEX32_RE = /^[0-9a-f]{32}$/i

function parseArgs(argv) {
  const out = { folder: null, launchId: null, noGoLive: false }
  for (const arg of argv) {
    if (arg === '--no-go-live') out.noGoLive = true
    else if (arg.startsWith('--launch-id=')) out.launchId = arg.slice('--launch-id='.length).trim()
    else if (!arg.startsWith('-')) out.folder = arg
  }
  return out
}

function resolveCollectionDir(arg) {
  const dir = path.isAbsolute(arg) ? arg : path.join(ROOT, arg.replace(/^collections[/\\]/, 'collections/'))
  return dir.includes(`${path.sep}collections${path.sep}`)
    ? dir
    : path.join(ROOT, 'collections', path.basename(dir))
}

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local')
  }
  return createClient(url, key)
}

function validatePubkey(raw, label) {
  const t = String(raw ?? '').trim()
  if (!t) throw new Error(`${label} is missing in cache.json — run sugar deploy first.`)
  if (UUID_RE.test(t) || UUID_HEX32_RE.test(t)) {
    throw new Error(
      `${label} looks like a launch UUID (${t.slice(0, 8)}…). Use program.candyMachine / program.collectionMint from cache.json (base58).`
    )
  }
  if (t.length < 32 || t.length > 44) {
    throw new Error(`${label} does not look like a Solana address (base58): ${t}`)
  }
  return t
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

async function fetchLaunch(db, launchId) {
  const { data, error } = await db.from('owl_center_launches').select('*').eq('id', launchId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Launch not found: ${launchId}`)
  return data
}

async function fetchAssetPackage(db, launchId) {
  const { data, error } = await db
    .from('owl_center_asset_packages')
    .select('validation_status, metadata_upload_status')
    .eq('launch_id', launchId)
    .maybeSingle()
  if (error) throw error
  return data
}

function assetsReady(launch, assetPackage) {
  if (launch.assets_ready && launch.metadata_ready) return true
  return (
    assetPackage?.validation_status === 'VALID' &&
    assetPackage?.metadata_upload_status === 'READY_FOR_CANDY_MACHINE'
  )
}

async function upsertMarketplace(db, launchId, cm, col, guard) {
  const notes = guard ? `Candy guard ${guard} (Sugar CLI sync)` : 'Sugar CLI sync'
  const { data, error } = await db
    .from('owl_center_marketplace_readiness')
    .upsert(
      {
        launch_id: launchId,
        candy_machine_id: cm,
        collection_mint: col,
        notes,
      },
      { onConflict: 'launch_id' }
    )
    .select('*')
    .single()
  if (error) throw error
  return data
}

async function mirrorLaunchIds(db, launchId, cm, col) {
  const { error } = await db
    .from('owl_center_launches')
    .update({
      candy_machine_id: cm,
      collection_mint: col,
      updated_at: new Date().toISOString(),
    })
    .eq('id', launchId)
  if (error) throw error
}

async function tryGoLive(db, launchId, launch, assetPackage) {
  const pending = launch.status === 'DRAFT' || launch.status === 'PENDING_REVIEW'
  const alreadyLive =
    !pending &&
    !launch.is_paused &&
    launch.active_phase === 'PUBLIC' &&
    launch.mint_mode === 'public_simple'

  if (alreadyLive) {
    return { ok: true, already_live: true }
  }

  if (!assetsReady(launch, assetPackage)) {
    return {
      ok: false,
      blockers: ['Mark asset package VALID + READY_FOR_CANDY_MACHINE in admin, then re-run or Approve & go live.'],
    }
  }

  if (!pending && launch.active_phase !== 'PUBLIC') {
    return {
      ok: false,
      blockers: [`Launch status is ${launch.status} / phase ${launch.active_phase} — use admin Go Live panel.`],
    }
  }

  const { error } = await db
    .from('owl_center_launches')
    .update({
      status: 'PUBLIC',
      active_phase: 'PUBLIC',
      is_paused: false,
      mint_mode: launch.slug === 'gen2' ? 'gen2_full' : 'public_simple',
      updated_at: new Date().toISOString(),
    })
    .eq('id', launchId)

  if (error) throw error
  return { ok: true, already_live: false }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.folder && !args.launchId) {
    throw new Error('Pass a collection folder or --launch-id=UUID, e.g. npm run sugar:sync-ids -- collections/papers')
  }

  let collectionDir = null
  let launchId = args.launchId
  let cache = null

  if (args.folder) {
    collectionDir = resolveCollectionDir(args.folder)
    const cachePath = path.join(collectionDir, 'cache.json')
    const configPath = path.join(collectionDir, 'config.json')
    if (!fs.existsSync(cachePath)) throw new Error(`Missing ${cachePath}`)
    cache = readJson(cachePath)
    if (!launchId && fs.existsSync(configPath)) {
      const config = readJson(configPath)
      launchId = config?.owlCenter?.launchId || null
    }
  }

  if (!launchId) {
    throw new Error(
      'Could not resolve launch id — pass --launch-id=UUID or regenerate config with npm run prepare:sugar-deploy (embeds owlCenter.launchId).'
    )
  }
  if (!UUID_RE.test(launchId)) {
    throw new Error(`Invalid launch id: ${launchId}`)
  }

  if (!cache && collectionDir) {
    cache = readJson(path.join(collectionDir, 'cache.json'))
  }
  if (!cache) {
    throw new Error('cache.json required — pass a collection folder with a Sugar deploy cache.')
  }

  const cm = validatePubkey(cache.program?.candyMachine, 'program.candyMachine')
  const col = validatePubkey(cache.program?.collectionMint, 'program.collectionMint')
  const guard = cache.program?.candyGuard?.trim() || null

  const db = getDb()
  const launch = await fetchLaunch(db, launchId)
  const assetPackage = await fetchAssetPackage(db, launchId)

  await upsertMarketplace(db, launchId, cm, col, guard)
  await mirrorLaunchIds(db, launchId, cm, col)

  console.log(`Synced to Owl Center launch ${launchId} (${launch.slug ?? '—'})`)
  console.log(`  Candy Machine: ${cm}`)
  console.log(`  Collection mint: ${col}`)
  if (guard) console.log(`  Candy Guard: ${guard}`)

  if (args.noGoLive) {
    console.log('\nSkipped go-live (--no-go-live).')
    return
  }

  const goLive = await tryGoLive(db, launchId, launch, assetPackage)
  if (goLive.ok && goLive.already_live) {
    console.log('\nLaunch already live on public mint page.')
  } else if (goLive.ok) {
    console.log(`\nAuto go-live OK — mint at /owl-center/collection/${launch.slug}`)
  } else {
    console.log('\nIDs saved. Go-live not applied:')
    for (const b of goLive.blockers ?? []) console.log(`  • ${b}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
