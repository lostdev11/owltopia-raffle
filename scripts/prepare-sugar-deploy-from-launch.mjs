/**
 * Pull a completed Owl Center Phase B upload job and build a local Sugar deploy folder.
 *
 * Usage:
 *   node --env-file=.env.local scripts/prepare-sugar-deploy-from-launch.mjs --launch-id=UUID
 *   node --env-file=.env.local scripts/prepare-sugar-deploy-from-launch.mjs --job-id=UUID
 *   node --env-file=.env.local scripts/prepare-sugar-deploy-from-launch.mjs --list
 *
 * Output: collections/{folder}/assets/*, config.json, cache.json (Arweave links pre-filled)
 * Then: npm run sugar:deploy -- collections/{folder}
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const STAGING_BUCKET = 'owl-center-asset-staging'

function parseArgs(argv) {
  const out = { list: false, launchId: null, jobId: null, outName: null }
  for (const arg of argv) {
    if (arg === '--list') out.list = true
    else if (arg.startsWith('--launch-id=')) out.launchId = arg.slice('--launch-id='.length).trim()
    else if (arg.startsWith('--job-id=')) out.jobId = arg.slice('--job-id='.length).trim()
    else if (arg.startsWith('--out=')) out.outName = arg.slice('--out='.length).trim()
  }
  return out
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function sanitizeFolderName(name) {
  return (name || 'collection')
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 48) || 'collection'
}

function basename(p) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
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

async function listJobs(db) {
  const { data, error } = await db
    .from('owl_center_asset_upload_jobs')
    .select('id,launch_id,original_filename,status,created_at')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  for (const row of data ?? []) {
    console.log(
      `${row.status.padEnd(10)} ${row.id}  launch=${row.launch_id ?? '—'}  ${row.original_filename ?? '—'}`
    )
  }
}

async function fetchJob(db, { launchId, jobId }) {
  if (jobId) {
    const { data, error } = await db.from('owl_center_asset_upload_jobs').select('*').eq('id', jobId).maybeSingle()
    if (error) throw error
    if (!data) throw new Error(`Job not found: ${jobId}`)
    return data
  }
  if (!launchId) throw new Error('Pass --launch-id= or --job-id= (or --list)')
  const { data, error } = await db
    .from('owl_center_asset_upload_jobs')
    .select('*')
    .eq('launch_id', launchId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new Error(`No completed upload job for launch ${launchId}. Stage + Push to Arweave first.`)
  }
  return data
}

async function fetchLaunch(db, launchId) {
  if (!launchId) return null
  const { data, error } = await db
    .from('owl_center_launches')
    .select('id,slug,name,symbol,total_supply,creator_wallet,description')
    .eq('id', launchId)
    .maybeSingle()
  if (error) throw error
  return data
}

function parseProgress(raw) {
  if (!raw || typeof raw !== 'object') return { uploaded: {}, file_list: [] }
  const o = raw
  const uploaded =
    o.uploaded && typeof o.uploaded === 'object' && !Array.isArray(o.uploaded) ? o.uploaded : {}
  const file_list = Array.isArray(o.file_list) ? o.file_list : []
  return { uploaded, file_list }
}

async function downloadZip(db, storagePath) {
  const { data, error } = await db.storage.from(STAGING_BUCKET).download(storagePath)
  if (error || !data) throw new Error(`Could not download staged ZIP: ${storagePath}`)
  return Buffer.from(await data.arrayBuffer())
}

function rewriteMetadataJson(rawJson, imageUri) {
  const parsed = JSON.parse(rawJson)
  parsed.image = imageUri
  if (parsed.properties && typeof parsed.properties === 'object' && Array.isArray(parsed.properties.files)) {
    parsed.properties.files = parsed.properties.files.map((f) =>
      typeof f.uri === 'string' && f.uri.endsWith('.png') ? { ...f, uri: imageUri } : f
    )
  }
  return `${JSON.stringify(parsed, null, 2)}\n`
}

/** Default guards for public_simple Owl Center mints (free on-chain; site enforces wallet limits + USDC platform fee). */
function publicSimpleSugarGuards() {
  return {
    default: {
      botTax: {
        value: 0.001,
        lastInstruction: false,
      },
    },
  }
}

function buildCacheItems(uploaded, assetsDir) {
  const items = {}
  const tokenRe = /^(\d+)\.(png|json)$/i

  for (const [zipPath, link] of Object.entries(uploaded)) {
    const base = basename(zipPath)
    const m = tokenRe.exec(base)
    if (!m) continue
    const index = m[1]
    const kind = m[2].toLowerCase()
    if (!items[index]) items[index] = { name: index }
    const filePath = path.join(assetsDir, base)
    if (!fs.existsSync(filePath)) continue
    const buf = fs.readFileSync(filePath)
    const hash = sha256Hex(buf)
    if (kind === 'png') {
      items[index].image_hash = hash
      items[index].image_link = link
    } else {
      items[index].metadata_hash = hash
      items[index].metadata_link = link
    }
    items[index].onChain = false
  }

  // Collection metadata (Sugar cache key "-1"; generator export often has no collection.png).
  const collectionJsonPath = path.join(assetsDir, 'collection.json')
  if (fs.existsSync(collectionJsonPath)) {
    const metaLink = uploaded['assets/collection.json']
    const buf = fs.readFileSync(collectionJsonPath)
    const collectionItem = {
      name: 'collection',
      metadata_hash: sha256Hex(buf),
      metadata_link: metaLink ?? '',
      onChain: false,
    }
    const collectionPng = path.join(assetsDir, 'collection.png')
    if (fs.existsSync(collectionPng)) {
      const pngBuf = fs.readFileSync(collectionPng)
      collectionItem.image_hash = sha256Hex(pngBuf)
      collectionItem.image_link =
        uploaded['assets/collection.png'] ?? uploaded['assets/0.png'] ?? ''
    }
    items['-1'] = collectionItem
  }

  return items
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const db = getDb()

  if (args.list) {
    await listJobs(db)
    return
  }

  const jobRow = await fetchJob(db, args)
  const progress = parseProgress(jobRow.upload_progress)
  if (!Object.keys(progress.uploaded).length) {
    throw new Error('Job has no Arweave URIs — complete Push to Arweave first.')
  }

  const launch = await fetchLaunch(db, jobRow.launch_id)
  const folderName = args.outName ?? sanitizeFolderName(launch?.name ?? jobRow.original_filename?.replace(/\.zip$/i, ''))
  const outDir = path.join(ROOT, 'collections', folderName)
  const assetsDir = path.join(outDir, 'assets')

  console.log(`Downloading ${jobRow.original_filename ?? 'staged.zip'}…`)
  const zipBuffer = await downloadZip(db, jobRow.staged_zip_path)
  const zip = await JSZip.loadAsync(zipBuffer)

  fs.mkdirSync(assetsDir, { recursive: true })

  for (const [entryPath, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    const norm = entryPath.replace(/\\/g, '/')
    if (!norm.startsWith('assets/')) continue
    const dest = path.join(outDir, norm)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const buf = Buffer.from(await file.async('arraybuffer'))
    fs.writeFileSync(dest, buf)
  }

  // Patch token metadata JSON with on-chain Arweave image URIs (matches Phase B upload).
  for (let i = 0; i < 10000; i++) {
    const pngLink = progress.uploaded[`assets/${i}.png`]
    const jsonPath = path.join(assetsDir, `${i}.json`)
    if (!pngLink || !fs.existsSync(jsonPath)) {
      if (i > 0 && !progress.uploaded[`assets/${i}.png`]) break
      continue
    }
    const raw = fs.readFileSync(jsonPath, 'utf8')
    fs.writeFileSync(jsonPath, rewriteMetadataJson(raw, pngLink))
  }

  // Generator export has collection.json but often no collection.png — use #0 art for Sugar.
  const collectionPng = path.join(assetsDir, 'collection.png')
  if (!fs.existsSync(collectionPng) && fs.existsSync(path.join(assetsDir, '0.png'))) {
    fs.copyFileSync(path.join(assetsDir, '0.png'), collectionPng)
    console.log('Note: added assets/collection.png from 0.png (generator export omits it).')
  }

  const supply =
    launch?.total_supply ??
    Object.keys(progress.uploaded).filter((p) => /assets\/\d+\.png$/i.test(p.replace(/\\/g, '/'))).length

  const config = {
    tokenStandard: 'nft',
    number: supply,
    symbol: launch?.symbol ?? 'COL',
    sellerFeeBasisPoints: 500,
    isMutable: true,
    isSequential: false,
    creators: [
      {
        address: launch?.creator_wallet ?? 'REPLACE_WITH_DEPLOYER_WALLET',
        share: 100,
      },
    ],
    uploadMethod: 'bundlr',
    ruleSet: null,
    awsConfig: null,
    sdriveApiKey: null,
    pinataConfig: null,
    hiddenSettings: null,
    guards: publicSimpleSugarGuards(),
    maxEditionSupply: null,
  }
  fs.writeFileSync(path.join(outDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)

  const cache = {
    program: {
      candyMachine: '',
      candyGuard: '',
      candyMachineCreator: '',
      collectionMint: '',
    },
    items: buildCacheItems(progress.uploaded, assetsDir),
  }
  fs.writeFileSync(path.join(outDir, 'cache.json'), `${JSON.stringify(cache, null, 2)}\n`)

  const readme = `# ${launch?.name ?? folderName} — Sugar deploy (Phase B)

Prepared from Owl Center upload job \`${jobRow.id}\`.

- Launch: \`${jobRow.launch_id ?? '—'}\` · slug \`${launch?.slug ?? '—'}\`
- Staged file: \`${jobRow.original_filename ?? '—'}\`
- Arweave links pre-filled in \`cache.json\` (skip \`sugar upload\` for numbered items).

## Deploy

1. Edit \`config.json\` if \`creators[0].address\` should be your deployer (not creator wallet).
2. Install [Sugar CLI](https://developers.metaplex.com/candy-machine/sugar).
3. \`solana config set --url\` your mainnet RPC; fund deployer keypair.
4. From this folder (mainnet — run `node --env-file=../../.env.local ../../scripts/configure-solana-mainnet-from-env.mjs` first):

\`\`\`bash
npm run sugar:deploy -- collections/${folderName}
\`\`\`

This runs \`sugar validate\`, \`sugar deploy\`, and \`sugar guard add\` (required for Owl Center mint UI).

If deploy asks for collection image upload, set cache \`-1\` \`image_link\` to token \`0\` image URL (collection.png is a copy of 0.png).

5. Paste **candy_machine_id** + **collection_mint** in Owl Center admin → Marketplace readiness.
6. Mint test: \`/owl-center/collection/${launch?.slug ?? 'YOUR_SLUG'}\`

Regenerate: \`npm run prepare:sugar-deploy -- --launch-id=${jobRow.launch_id ?? 'LAUNCH_UUID'}\`
`

  fs.writeFileSync(path.join(outDir, 'README.md'), readme)

  console.log('')
  console.log(`Prepared Sugar folder: collections/${folderName}`)
  console.log(`  Launch: ${launch?.name ?? '—'} (${launch?.slug ?? jobRow.launch_id ?? '—'})`)
  console.log(`  Supply: ${supply} · Creator in config: ${config.creators[0].address}`)
  console.log(`  cache.json items: ${Object.keys(cache.items).filter((k) => k !== 'collection').length} tokens`)
  console.log('')
  console.log('Next:')
  console.log(`  npm run sugar:deploy -- collections/${folderName}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
