#!/usr/bin/env node
/**
 * Backfill the Owl Center asset upload job's `upload_progress.uploaded` map for
 * the Gen 2 launch from the standalone Irys upload manifest.
 *
 * Why: Gen 2 assets were pushed to Arweave by `scripts/upload-gen2-irys.mjs`,
 * which writes links to `collections/owltopia-gen2/.irys-uploaded.json` — it never
 * populated the DB `owl_center_asset_upload_jobs.upload_progress.uploaded` map.
 * The hub-card cover picker (`listLaunchCoverCandidates`) reads that map, so the
 * "Pick from uploaded assets" grid shows nothing. This fills it in.
 *
 * The job's `file_list` paths are prefixed `gen2/<n>.png`; the manifest keys are
 * `assets/<n>.png`. We map the first path segment to `assets/` to line them up.
 *
 * Run:
 *   node --env-file=.env.local scripts/backfill-gen2-cover-uploads.mjs
 *   node --env-file=.env.local scripts/backfill-gen2-cover-uploads.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-gen2-cover-uploads.mjs --slug=gen2
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const MANIFEST_PATH = path.join(ROOT, 'collections', 'owltopia-gen2', '.irys-uploaded.json')

const DRY_RUN = process.argv.includes('--dry-run')
const SLUG = (process.argv.find((a) => a.startsWith('--slug=')) ?? '--slug=gen2').slice('--slug='.length)

function isHttpUrl(v) {
  return typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))
}

/**
 * Map a job `file_list` path to the manifest key(s), in priority order.
 *
 * The job's staged zip numbers tokens 1-based (`gen2/1.png` … `gen2/2000.png`),
 * while the Irys manifest numbers files 0-based (`assets/0.png` … `assets/1999.png`)
 * — confirmed by metadata: file `assets/1593.json` is "Owltopia G2 #1594". So a
 * numbered token N maps to `assets/(N-1).<ext>`. Non-numbered files (collection,
 * traits) map straight across by name. We keep a direct-name fallback for safety.
 */
function manifestKeyCandidates(jobPath) {
  const slash = jobPath.indexOf('/')
  const rest = slash < 0 ? jobPath : jobPath.slice(slash + 1)
  const dot = rest.lastIndexOf('.')
  const base = dot < 0 ? rest : rest.slice(0, dot)
  const ext = dot < 0 ? '' : rest.slice(dot)
  if (/^\d+$/.test(base)) {
    const n = Number(base)
    return [`assets/${n - 1}${ext}`, `assets/${n}${ext}`]
  }
  return [`assets/${rest}`]
}

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local')
  }
  return createClient(url, key)
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found: ${MANIFEST_PATH}`)
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const manifestCount = Object.keys(manifest).length
  console.log(`Loaded ${manifestCount} Arweave entries from ${path.relative(ROOT, MANIFEST_PATH)}`)

  const db = getDb()

  const { data: launch, error: launchErr } = await db
    .from('owl_center_launches')
    .select('id, slug, name')
    .eq('slug', SLUG)
    .maybeSingle()
  if (launchErr) throw launchErr
  if (!launch) throw new Error(`No launch found with slug "${SLUG}"`)
  console.log(`Launch: ${launch.name} (${launch.slug}) ${launch.id}`)

  const { data: jobs, error: jobErr } = await db
    .from('owl_center_asset_upload_jobs')
    .select('*')
    .eq('launch_id', launch.id)
    .in('status', ['completed', 'uploading'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (jobErr) throw jobErr
  const job = jobs?.[0]
  if (!job) throw new Error(`No completed/uploading asset upload job for launch ${launch.id}`)

  const progress = job.upload_progress ?? {}
  const fileList = Array.isArray(progress.file_list) ? progress.file_list : []
  if (fileList.length === 0) throw new Error(`Job ${job.id} has an empty file_list — cannot map uploads.`)

  const uploaded = { ...(progress.uploaded ?? {}) }
  let matched = 0
  let missing = 0
  const missingSamples = []

  for (const entry of fileList) {
    const p = entry?.path
    if (typeof p !== 'string') continue
    if (isHttpUrl(uploaded[p])) continue
    const url = manifestKeyCandidates(p)
      .map((k) => manifest[k])
      .find((v) => isHttpUrl(v))
    if (isHttpUrl(url)) {
      uploaded[p] = url
      matched += 1
    } else {
      missing += 1
      if (missingSamples.length < 10) missingSamples.push(p)
    }
  }

  const imageEntries = fileList.filter((e) => e?.kind === 'image').length
  console.log(`file_list entries: ${fileList.length} (images: ${imageEntries})`)
  console.log(`Matched Arweave URLs: ${matched}`)
  console.log(`Unmatched file_list paths: ${missing}${missing ? ` (e.g. ${missingSamples.join(', ')})` : ''}`)
  console.log(`uploaded map size after backfill: ${Object.keys(uploaded).length}`)

  if (matched === 0) {
    throw new Error('No file_list paths matched the manifest — check the path prefix mapping.')
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: no DB write performed.')
    return
  }

  const nextProgress = { ...progress, uploaded }
  const { error: updErr } = await db
    .from('owl_center_asset_upload_jobs')
    .update({ upload_progress: nextProgress, updated_at: new Date().toISOString() })
    .eq('id', job.id)
  if (updErr) throw updErr

  console.log(`\nUpdated job ${job.id}. The hub-card cover picker can now list Gen 2 NFT images.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
