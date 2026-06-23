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
  const out = { list: false, launchId: null, jobId: null, outName: null, preUpload: false }
  for (const arg of argv) {
    if (arg === '--list') out.list = true
    else if (arg === '--pre-upload') out.preUpload = true
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

async function fetchJob(db, { launchId, jobId, preUpload }) {
  if (jobId) {
    const { data, error } = await db.from('owl_center_asset_upload_jobs').select('*').eq('id', jobId).maybeSingle()
    if (error) throw error
    if (!data) throw new Error(`Job not found: ${jobId}`)
    return data
  }
  if (!launchId) throw new Error('Pass --launch-id= or --job-id= (or --list)')
  // Pre-upload mode builds the Sugar folder straight from the staged ZIP, so it
  // accepts any staged job (no completed Arweave upload required).
  let query = db
    .from('owl_center_asset_upload_jobs')
    .select('*')
    .eq('launch_id', launchId)
  if (!preUpload) query = query.eq('status', 'completed')
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!data) {
    throw new Error(
      preUpload
        ? `No staged upload job for launch ${launchId}. Stage a Sugar ZIP first.`
        : `No completed upload job for launch ${launchId}. Stage + Push to Arweave first.`
    )
  }
  return data
}

async function fetchLaunch(db, launchId) {
  if (!launchId) return null
  const { data, error } = await db
    .from('owl_center_launches')
    .select('id,slug,name,symbol,total_supply,creator_wallet,description,seller_fee_basis_points')
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
  const preUpload = args.preUpload || !Object.keys(progress.uploaded).length
  if (!preUpload && !Object.keys(progress.uploaded).length) {
    throw new Error('Job has no Arweave URIs — complete Push to Arweave first, or pass --pre-upload to deploy via local `sugar upload`.')
  }
  if (preUpload) {
    console.log('Pre-upload mode: building Sugar folder from staged ZIP. Run `sugar upload` locally before deploy.')
  }

  const launch = await fetchLaunch(db, jobRow.launch_id)
  const folderName = args.outName ?? sanitizeFolderName(launch?.name ?? jobRow.original_filename?.replace(/\.zip$/i, ''))
  const outDir = path.join(ROOT, 'collections', folderName)
  const assetsDir = path.join(outDir, 'assets')

  console.log(`Downloading ${jobRow.original_filename ?? 'staged.zip'}…`)
  const zipBuffer = await downloadZip(db, jobRow.staged_zip_path)
  const zip = await JSZip.loadAsync(zipBuffer)

  fs.mkdirSync(assetsDir, { recursive: true })

  // Flatten Sugar assets into assets/ regardless of the ZIP's internal layout
  // (generator exports nest under assets/, but hand-made ZIPs may put files at
  // the root or under a named folder). Match by basename.
  let extracted = 0
  for (const [entryPath, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    const base = basename(entryPath)
    const keep =
      /^\d+\.(png|json)$/i.test(base) ||
      /^collection\.(png|json)$/i.test(base) ||
      /^traits\.csv$/i.test(base)
    if (!keep) continue
    const buf = Buffer.from(await file.async('arraybuffer'))
    fs.writeFileSync(path.join(assetsDir, base), buf)
    extracted += 1
  }
  console.log(`Extracted ${extracted} asset files into collections/${folderName}/assets/`)
  if (extracted === 0) {
    throw new Error('No Sugar asset files (N.png / N.json) found in the staged ZIP — check its contents.')
  }

  // Patch token metadata JSON with on-chain Arweave image URIs (matches Phase B upload).
  // Skipped in pre-upload mode — `sugar upload` rewrites image URIs itself.
  if (!preUpload) {
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
  }

  // Generator export has collection.json but often no collection.png — use #0 art for Sugar.
  const collectionPng = path.join(assetsDir, 'collection.png')
  if (!fs.existsSync(collectionPng) && fs.existsSync(path.join(assetsDir, '0.png'))) {
    fs.copyFileSync(path.join(assetsDir, '0.png'), collectionPng)
    console.log('Note: added assets/collection.png from 0.png (generator export omits it).')
  }

  // Count token PNGs on disk so pre-upload mode (no Arweave URIs) still works.
  const diskPngCount = fs
    .readdirSync(assetsDir)
    .filter((f) => /^\d+\.png$/i.test(f)).length
  const uploadedPngCount = Object.keys(progress.uploaded).filter((p) =>
    /assets\/\d+\.png$/i.test(p.replace(/\\/g, '/'))
  ).length
  const tokenCount = uploadedPngCount || diskPngCount

  const supply = launch?.total_supply ?? tokenCount

  const nameLength = Math.max(1, String(Math.max(0, tokenCount - 1)).length)
  const collectionLabel = (launch?.name ?? folderName).trim() || 'Collection'
  const prefixName = `${collectionLabel.slice(0, Math.max(1, 32 - nameLength - 2))} #`
  // Bundlr/Arweave gateway URIs are `https://arweave.net/<43-char-tx>` = 63 chars.
  // In pre-upload mode `sugar upload` writes these, so size the config line for them.
  const uriLength = preUpload
    ? 63
    : Math.max(
        32,
        ...Object.values(progress.uploaded)
          .filter((u) => typeof u === 'string')
          .map((u) => u.length)
      )

  const config = {
    owlCenter: {
      launchId: jobRow.launch_id ?? null,
      slug: launch?.slug ?? null,
      jobId: jobRow.id,
    },
    tokenStandard: 'nft',
    number: supply,
    symbol: launch?.symbol ?? 'COL',
    sellerFeeBasisPoints: Number(launch?.seller_fee_basis_points) >= 0 ? Number(launch.seller_fee_basis_points) : 500,
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
    configLineSettings: {
      prefixName,
      nameLength,
      prefixUri: '',
      uriLength,
      isSequential: false,
    },
    guards: publicSimpleSugarGuards(),
    maxEditionSupply: null,
  }
  fs.writeFileSync(path.join(outDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)

  // In pre-upload mode we let `sugar upload` create cache.json (it records the
  // real Arweave links + hashes). Only pre-fill cache for completed Phase B jobs.
  if (!preUpload) {
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
  }

  const readme = `# ${launch?.name ?? folderName} — Sugar deploy (Phase B)

Prepared from Owl Center upload job \`${jobRow.id}\`.

- Launch: \`${jobRow.launch_id ?? '—'}\` · slug \`${launch?.slug ?? '—'}\`
- Staged file: \`${jobRow.original_filename ?? '—'}\`
- Arweave links pre-filled in \`cache.json\` (skip \`sugar upload\` for numbered items).

## Deploy

1. Edit \`config.json\` if \`creators[0].address\` should be your deployer (not creator wallet).
2. Install [Sugar CLI](https://developers.metaplex.com/candy-machine/sugar).
3. \`solana config set --url\` your mainnet RPC; fund deployer keypair.
4. From this folder (mainnet — run \`node --env-file=../../.env.local ../../scripts/configure-solana-mainnet-from-env.mjs\` first):

\`\`\`bash
npm run sugar:deploy -- collections/${folderName}
\`\`\`

This runs \`sugar validate\`, \`sugar deploy\`, and \`sugar guard add\` (required for Owl Center mint UI).

If deploy asks for collection image upload, set cache \`-1\` \`image_link\` to token \`0\` image URL (collection.png is a copy of 0.png).

5. **Auto-sync** (if \`config.json\` has \`owlCenter.launchId\`): \`npm run sugar:sync-ids -- collections/${folderName}\` — or use **Import cache.json** in admin.

6. Mint test: \`/owl-center/collection/${launch?.slug ?? 'YOUR_SLUG'}\`

Regenerate: \`npm run prepare:sugar-deploy -- --launch-id=${jobRow.launch_id ?? 'LAUNCH_UUID'}\`
`

  fs.writeFileSync(path.join(outDir, 'README.md'), readme)

  console.log('')
  console.log(`Prepared Sugar folder: collections/${folderName}`)
  console.log(`  Launch: ${launch?.name ?? '—'} (${launch?.slug ?? jobRow.launch_id ?? '—'})`)
  console.log(`  Supply: ${supply} · Creator in config: ${config.creators[0].address}`)
  console.log(`  Token PNGs: ${tokenCount}`)
  console.log('')
  console.log('Next:')
  if (preUpload) {
    console.log(`  cd collections/${folderName}`)
    console.log('  node --env-file=../../.env.local ../../scripts/configure-solana-mainnet-from-env.mjs')
    console.log('  sugar validate')
    console.log('  sugar upload        # uploads assets to Arweave (Bundlr) — needs funded deployer wallet')
    console.log('  cd ../..')
    console.log(`  npm run sugar:deploy -- collections/${folderName}   # deploy + guard + sync IDs`)
  } else {
    console.log(`  npm run sugar:deploy -- collections/${folderName}`)
    console.log(`  npm run sugar:sync-ids -- collections/${folderName}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
