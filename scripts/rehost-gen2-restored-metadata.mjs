/**
 * Rehost art + metadata for Gen2 mints whose repair uploads landed on Irys IDs
 * that never became publicly fetchable (marketplaces showed broken images).
 *
 * For each restored mint:
 *   - upload pack (N+1).png to Supabase Storage (public)
 *   - write JSON with pack (N+1) traits but name "Owltopia G2 #N" so marketplace
 *     display matches the on-chain name (avoids duplicate #N+1 listings)
 *   - updateV1 the mint URI
 *
 *   node --env-file=.env.local scripts/rehost-gen2-restored-metadata.mjs --assets="..."
 *   node --env-file=.env.local scripts/rehost-gen2-restored-metadata.mjs --assets="..." --execute
 *   node --env-file=.env.local scripts/rehost-gen2-restored-metadata.mjs --assets="..." --execute --max=5
 */
import fs from 'node:fs'
import path from 'node:path'
import bs58 from 'bs58'
import { createClient } from '@supabase/supabase-js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  fetchMetadata,
  findMetadataPda,
  mplTokenMetadata,
  updateV1,
} from '@metaplex-foundation/mpl-token-metadata'
import { createSignerFromKeypair, publicKey, signerIdentity, some } from '@metaplex-foundation/umi'

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
const IRYS_KEY = process.env.IRYS_PRIVATE_KEY?.trim()
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const SB_KEY = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()

const BUCKET = 'gen2-metadata'
const PREFIX = 'gen2'
/** Already rehosted by hand while diagnosing. */
const SKIP_MINTS = new Set(['7Sc7fEKqgB8eeDrQagaQTyKTYqcPoTxm2VtiY2JCSeDw'])

function parseArgs(argv) {
  const o = { execute: false, assets: null, max: Infinity }
  for (const a of argv) {
    if (a === '--execute') o.execute = true
    else if (a.startsWith('--assets=')) o.assets = a.slice(9).replace(/^"|"$/g, '')
    else if (a.startsWith('--max=')) o.max = Math.max(1, parseInt(a.slice(6), 10) || 0)
  }
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Restore logs use slightly different shapes; normalize to { mint, n, pack }. */
function loadPlan() {
  const rows = []
  const seen = new Set()
  const push = (mint, n, pack) => {
    if (!mint || n == null || pack == null) return
    if (seen.has(mint)) return
    seen.add(mint)
    rows.push({ mint, n, pack })
  }

  const read = (file) => {
    const p = path.join('scripts', file)
    if (!fs.existsSync(p)) return []
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(j) ? j : j.results || []
  }

  for (const r of read('_restore-off-by-one-results.json')) {
    if (r.status !== 'restored') continue
    push(r.mint, r.onchainNum, r.packFile)
  }
  for (const r of read('_restore-water-1of1-results.json')) {
    if (r.status !== 'restored') continue
    // Names look like "Owltopia G2 #1171" — anchor on the # so the "2" in "G2" is ignored.
    const m = String(r.onchainName || '').match(/#(\d+)/)
    push(r.mint, m ? parseInt(m[1], 10) : null, r.packFile)
  }
  for (const r of read('_restore-remaining-2.json')) {
    push(r.mint, r.n, r.pack)
  }
  return rows
}

function resolveAssetPaths(assetsDir, n) {
  const png = path.join(assetsDir, `${n}.png`)
  const jsonCandidates = [
    path.join(assetsDir, 'New folder', `${n}.json`),
    path.join(assetsDir, 'new folder', `${n}.json`),
    path.join(assetsDir, `${n}.json`),
  ]
  const json = jsonCandidates.find((p) => fs.existsSync(p)) || null
  return { png: fs.existsSync(png) ? png : null, json }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!RPC || !SB_URL || !SB_KEY) {
    console.error('Missing NEXT_PUBLIC_SOLANA_RPC_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY')
    process.exit(1)
  }
  if (!args.assets || !fs.existsSync(args.assets)) {
    console.error('Pass --assets=<extracted gen2 folder>')
    process.exit(1)
  }

  const plan = loadPlan().filter((p) => !SKIP_MINTS.has(p.mint))
  const batch = plan.slice(0, args.max === Infinity ? undefined : args.max)

  console.log(`Mode: ${args.execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Candidates: ${plan.length} (batch ${batch.length})`)
  for (const p of batch.slice(0, 8)) {
    const files = resolveAssetPaths(args.assets, p.pack)
    console.log(`  #${p.n} <- pack ${p.pack} png=${files.png ? fs.statSync(files.png).size : 'MISSING'}`)
  }
  if (!args.execute) {
    console.log('\nRe-run with --execute to apply.')
    return
  }
  if (!IRYS_KEY) {
    console.error('Missing IRYS_PRIVATE_KEY (update authority signer)')
    process.exit(1)
  }

  const sb = createClient(SB_URL, SB_KEY)
  const { data: buckets } = await sb.storage.listBuckets()
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true })
    if (error) throw new Error(`createBucket: ${error.message}`)
  }

  const secret = IRYS_KEY.startsWith('[')
    ? Uint8Array.from(JSON.parse(IRYS_KEY).slice(0, 64))
    : bs58.decode(IRYS_KEY)
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplTokenMetadata())
  const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret))
  umi.use(signerIdentity(signer))
  const signerAddr = String(umi.identity.publicKey)
  console.log(`Signer: ${signerAddr}`)

  const summary = { rehosted: 0, skipped: 0, failed: 0, results: [] }

  for (const step of batch) {
    const files = resolveAssetPaths(args.assets, step.pack)
    if (!files.png || !files.json) {
      summary.skipped++
      summary.results.push({ ...step, status: 'missing_local_files' })
      console.log(`SKIP  #${step.n} missing local pack ${step.pack}`)
      continue
    }

    try {
      const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(step.mint) }))
      if (String(md.updateAuthority) !== signerAddr) {
        summary.failed++
        summary.results.push({ ...step, status: 'authority_mismatch' })
        console.log(`FAIL  #${step.n} authority_mismatch`)
        continue
      }

      const imgKey = `${PREFIX}/${step.n}.png`
      const { error: imgErr } = await sb.storage
        .from(BUCKET)
        .upload(imgKey, fs.readFileSync(files.png), { contentType: 'image/png', upsert: true })
      if (imgErr) throw new Error(`image upload: ${imgErr.message}`)
      const imageUri = sb.storage.from(BUCKET).getPublicUrl(imgKey).data.publicUrl

      const pack = JSON.parse(fs.readFileSync(files.json, 'utf8'))
      const onchainName = `Owltopia G2 #${step.n}`
      const meta = {
        ...pack,
        name: onchainName,
        symbol: String(pack.symbol || 'OWL2'),
        image: imageUri,
        properties: {
          ...(pack.properties || {}),
          files: [{ uri: imageUri, type: 'image/png' }],
          category: 'image',
        },
      }

      const jsonKey = `${PREFIX}/${step.n}.json`
      const { error: jsonErr } = await sb.storage
        .from(BUCKET)
        .upload(jsonKey, Buffer.from(JSON.stringify(meta, null, 2), 'utf8'), {
          contentType: 'application/json',
          upsert: true,
        })
      if (jsonErr) throw new Error(`json upload: ${jsonErr.message}`)
      const newUri = sb.storage.from(BUCKET).getPublicUrl(jsonKey).data.publicUrl

      let sigStr = null
      let lastErr = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await updateV1(umi, {
            mint: publicKey(step.mint),
            authority: umi.identity,
            data: some({
              name: onchainName.slice(0, 32),
              symbol: String(meta.symbol).slice(0, 10),
              uri: newUri,
              sellerFeeBasisPoints: md.sellerFeeBasisPoints,
              creators: md.creators,
            }),
          }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
          sigStr = typeof res.signature === 'string' ? res.signature : bs58.encode(res.signature)
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          await sleep(2000 * (attempt + 1))
        }
      }
      if (lastErr) throw lastErr

      summary.rehosted++
      summary.results.push({
        ...step,
        status: 'rehosted',
        name: onchainName,
        imageUri,
        newUri,
        signature: sigStr,
      })
      console.log(`OK    #${step.n} <- pack ${step.pack}  ${sigStr.slice(0, 16)}…`)
      await sleep(500)
    } catch (e) {
      summary.failed++
      summary.results.push({ ...step, status: 'error', error: String(e.message || e) })
      console.log(`FAIL  #${step.n} ${String(e.message || e)}`)
      await sleep(1200)
    }
  }

  fs.writeFileSync(
    path.join('scripts', '_rehost-restored-results.json'),
    JSON.stringify({ rehosted_at: new Date().toISOString(), ...summary }, null, 2)
  )
  console.log('\nDone.', { rehosted: summary.rehosted, skipped: summary.skipped, failed: summary.failed })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
