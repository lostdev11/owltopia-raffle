/**
 * Audit + restore Gen2 mints that were shifted by the local-assets repair
 * (pack N written onto on-chain name N). Mint-time mapping was on-chain N → pack N+1.
 *
 * Also spot-checks the 17 cache-recovered mints (should already be correct).
 *
 *   node --env-file=.env.local scripts/restore-gen2-off-by-one-repairs.mjs --assets="..."
 *   node --env-file=.env.local scripts/restore-gen2-off-by-one-repairs.mjs --assets="..." --execute
 *   node --env-file=.env.local scripts/restore-gen2-off-by-one-repairs.mjs --assets="..." --execute --max=5
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  fetchMetadata,
  findMetadataPda,
  mplTokenMetadata,
  updateV1,
} from '@metaplex-foundation/mpl-token-metadata'
import { createSignerFromKeypair, publicKey, signerIdentity, some } from '@metaplex-foundation/umi'
import { Uploader } from '@irys/upload'
import { Solana } from '@irys/upload-solana'

const require = createRequire(import.meta.url)
const localFix = require('./_gen2-local-assets-fix-results.json')
const brokenScan = require('./_gen2-broken-images.json')
const brokenFix = require('./_gen2-broken-fix-results.json')
const waterRestore = require('./_restore-water-1of1-results.json')

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const IRYS_KEY = process.env.IRYS_PRIVATE_KEY?.trim()

const ALREADY_OK = new Set(
  (waterRestore.results || []).filter((r) => r.status === 'restored').map((r) => r.mint)
)

function parseArgs(argv) {
  const o = { execute: false, assets: null, max: Infinity, auditOnly: false }
  for (const a of argv) {
    if (a === '--execute') o.execute = true
    else if (a === '--audit-only') o.auditOnly = true
    else if (a.startsWith('--assets=')) o.assets = a.slice(9).replace(/^"|"$/g, '')
    else if (a.startsWith('--max=')) o.max = Math.max(1, parseInt(a.slice(6), 10) || 0)
  }
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tokenNum(name) {
  const m = String(name || '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function arweaveTxId(url) {
  try {
    return new URL(String(url).trim()).pathname.replace(/^\//, '').split('/')[0] || null
  } catch {
    return null
  }
}

function attrsKey(attrs) {
  return JSON.stringify(
    (attrs || [])
      .map((a) => [String(a.trait_type), String(a.value)])
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
  )
}

function oneOne(attrs) {
  const hit = (attrs || []).find((a) => String(a.trait_type) === '1/1')
  return hit ? String(hit.value) : null
}

async function fetchJson(uri) {
  if (!uri) return null
  const id = arweaveTxId(uri)
  const candidates = [
    uri,
    id ? `https://arweave.net/${id}` : null,
    id ? `https://gateway.irys.xyz/${id}` : null,
  ].filter(Boolean)
  for (const url of [...new Set(candidates)]) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) continue
      const text = await res.text()
      if (text.trimStart().startsWith('<')) continue
      return JSON.parse(text)
    } catch {
      /* next */
    }
  }
  return null
}

function buildWalletSafeJson(json, imageGatewayUrl) {
  const id = arweaveTxId(imageGatewayUrl)
  if (!id) return null
  const gatewayBase = `https://gateway.irys.xyz/${id}`
  const gatewayImage = `${gatewayBase}?ext=png`
  const primaryImage = `${SITE_URL}/api/proxy-image?url=${encodeURIComponent(gatewayBase)}`
  const out = { ...json, image: primaryImage }
  const props = json.properties && typeof json.properties === 'object' ? { ...json.properties } : {}
  props.files = [
    { uri: primaryImage, type: 'image/png', cdn: true },
    { uri: gatewayImage, type: 'image/png' },
  ]
  props.category = 'image'
  out.properties = props
  return out
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

function loadPackJson(assetsDir, n) {
  const files = resolveAssetPaths(assetsDir, n)
  if (!files.json) return null
  return JSON.parse(fs.readFileSync(files.json, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!RPC) {
    console.error('Missing NEXT_PUBLIC_SOLANA_RPC_URL')
    process.exit(1)
  }
  if (!args.assets || !fs.existsSync(args.assets)) {
    console.error('Pass --assets=<extracted gen2 folder>')
    process.exit(1)
  }

  const brokenByMint = new Map((brokenScan.items || []).map((i) => [i.mint, i]))

  // --- Audit cache-recovered 17 ---
  const cacheRows = []
  for (const r of (brokenFix.results || []).filter((x) => x.status === 'fixed')) {
    const n = tokenNum(r.name)
    const scan = brokenByMint.get(r.mint)
    const old = scan?.json_uri ? await fetchJson(scan.json_uri) : null
    const packN = n != null ? loadPackJson(args.assets, n) : null
    const packNp1 = n != null ? loadPackJson(args.assets, n + 1) : null
    let verdict = 'unknown'
    if (old && packNp1 && attrsKey(old.attributes) === attrsKey(packNp1.attributes)) {
      verdict = 'old_matches_pack_N+1'
    } else if (old && packN && attrsKey(old.attributes) === attrsKey(packN.attributes)) {
      verdict = 'old_matches_pack_N'
    }
    // current DAS
    let live = null
    try {
      const das = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: r.mint } }),
      }).then((x) => x.json())
      live = das.result?.content?.metadata
    } catch {
      /* ignore */
    }
    let liveAlign = 'unknown'
    if (live?.attributes && packNp1 && attrsKey(live.attributes) === attrsKey(packNp1.attributes)) {
      liveAlign = 'live_pack_N+1_OK'
    } else if (live?.attributes && packN && attrsKey(live.attributes) === attrsKey(packN.attributes)) {
      liveAlign = 'live_pack_N_SHIFTED'
    } else if (old && live?.attributes && attrsKey(live.attributes) === attrsKey(old.attributes)) {
      liveAlign = 'live_matches_old'
    }
    cacheRows.push({
      mint: r.mint,
      name: r.name,
      source: r.source,
      oldName: old?.name || null,
      oldOne: oneOne(old?.attributes),
      verdict,
      liveAlign,
      liveName: live?.name || null,
      liveOne: oneOne(live?.attributes),
    })
    console.log(`CACHE #${r.name} ${verdict} ${liveAlign}`)
  }

  // --- Plan restores: local 102 + cache 17 (all shifted to pack N) ---
  const candidates = []
  const seen = new Set()
  for (const r of localFix.results || []) {
    if (seen.has(r.mint)) continue
    seen.add(r.mint)
    candidates.push({ mint: r.mint, name: r.name, cohort: 'local' })
  }
  for (const r of (brokenFix.results || []).filter((x) => x.status === 'fixed')) {
    if (seen.has(r.mint)) continue
    seen.add(r.mint)
    candidates.push({ mint: r.mint, name: r.name, cohort: 'cache' })
  }

  const plan = []
  for (const r of candidates) {
    const n = tokenNum(r.name)
    if (n == null) continue
    const scan = brokenByMint.get(r.mint)
    const old = scan?.json_uri ? await fetchJson(scan.json_uri) : null
    const packN = loadPackJson(args.assets, n)
    const packNp1 = loadPackJson(args.assets, n + 1)
    const filesNp1 = resolveAssetPaths(args.assets, n + 1)

    let oldAlign = 'old_unreadable'
    if (old && packNp1 && attrsKey(old.attributes) === attrsKey(packNp1.attributes)) oldAlign = 'old_is_pack_N+1'
    else if (old && packN && attrsKey(old.attributes) === attrsKey(packN.attributes)) oldAlign = 'old_is_pack_N'
    else if (old) oldAlign = 'old_matches_neither'

    const already = ALREADY_OK.has(r.mint)
    const skipReason = already
      ? 'already_water_restored'
      : oldAlign === 'old_is_pack_N'
        ? 'old_was_pack_N_unexpected'
        : !filesNp1.png || !filesNp1.json
          ? 'missing_pack_N+1_files'
          : null

    const needsRestore =
      !skipReason &&
      (oldAlign === 'old_is_pack_N+1' || oldAlign === 'old_unreadable' || oldAlign === 'old_matches_neither')

    const row = {
      mint: r.mint,
      cohort: r.cohort,
      onchainNum: n,
      packFile: n + 1,
      onchainName: `Owltopia G2 #${n}`,
      oldAlign,
      oldName: old?.name || null,
      oldOne: oneOne(old?.attributes),
      packNp1Name: packNp1?.name || null,
      packNp1One: oneOne(packNp1?.attributes),
      needsRestore: Boolean(needsRestore),
      skipReason,
    }
    plan.push(row)
  }

  const need = plan.filter((p) => p.needsRestore)
  const skipped = plan.filter((p) => !p.needsRestore)
  console.log('\nRESTORE plan:', {
    total: plan.length,
    needRestore: need.length,
    skipped: skipped.length,
    bySkip: skipped.reduce((a, s) => {
      a[s.skipReason || 'other'] = (a[s.skipReason || 'other'] || 0) + 1
      return a
    }, {}),
    byOldAlign: plan.reduce((a, s) => {
      a[s.oldAlign] = (a[s.oldAlign] || 0) + 1
      return a
    }, {}),
  })

  const auditOut = {
    audited_at: new Date().toISOString(),
    cache_recovered_17: cacheRows,
    local_102: plan,
    summary: {
      cache_live_ok: cacheRows.filter((r) => r.liveAlign === 'live_pack_N+1_OK' || r.liveAlign === 'live_matches_old')
        .length,
      cache_live_shifted: cacheRows.filter((r) => r.liveAlign === 'live_pack_N_SHIFTED').length,
      local_need_restore: need.length,
    },
  }
  fs.writeFileSync(path.join('scripts', '_audit-off-by-one-repairs.json'), JSON.stringify(auditOut, null, 2))
  console.log('Wrote scripts/_audit-off-by-one-repairs.json')

  if (args.auditOnly || !args.execute) {
    console.log(`\nMode: ${args.execute ? 'EXECUTE' : 'DRY RUN / AUDIT'}`)
    console.log(`Would restore ${Math.min(need.length, args.max)} of ${need.length}`)
    for (const p of need.slice(0, 15)) {
      console.log(
        `  #${p.onchainNum} -> pack ${p.packFile} (${p.packNp1One || 'regular'}) old=${p.oldAlign} ${p.oldName || ''}`
      )
    }
    if (need.length > 15) console.log(`  ... +${need.length - 15} more`)
    if (!args.execute) console.log('\nRe-run with --execute to apply restores.')
    if (!args.execute) return
  }

  if (!IRYS_KEY) {
    console.error('Missing IRYS_PRIVATE_KEY')
    process.exit(1)
  }

  const secret = IRYS_KEY.startsWith('[')
    ? Uint8Array.from(JSON.parse(IRYS_KEY).slice(0, 64))
    : bs58.decode(IRYS_KEY)
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplTokenMetadata())
  const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret))
  umi.use(signerIdentity(signer))
  const signerAddr = String(umi.identity.publicKey)
  console.log(`Signer: ${signerAddr}`)

  const irys = await Uploader(Solana).withWallet(IRYS_KEY).withRpc(RPC)
  const batch = need.slice(0, args.max === Infinity ? undefined : args.max)
  try {
    const estBytes = batch.length * 600_000
    const price = await irys.getPrice(estBytes)
    const bal = await irys.getLoadedBalance()
    console.log(`Irys balance=${bal} price~${price} for ${batch.length} mints`)
    if (bal < price) {
      console.log(`Funding Irys ~${price - bal}...`)
      await irys.fund(price - bal, 1.3)
    }
  } catch (e) {
    console.warn('Irys fund best-effort:', String(e.message || e))
  }

  const results = []
  for (const step of batch) {
    const files = resolveAssetPaths(args.assets, step.packFile)
    try {
      const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(step.mint) }))
      if (String(md.updateAuthority) !== signerAddr) {
        results.push({ ...step, status: 'authority_mismatch' })
        console.log(`FAIL  #${step.onchainNum} authority_mismatch`)
        continue
      }
      const localJson = JSON.parse(fs.readFileSync(files.json, 'utf8'))
      const pngBuf = fs.readFileSync(files.png)
      const pngReceipt = await irys.upload(pngBuf, {
        tags: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'App-Name', value: 'Owltopia-Gen2-OffByOne-Restore' },
        ],
      })
      const imageGateway = `https://gateway.irys.xyz/${String(pngReceipt.id)}`
      const fixedJson = buildWalletSafeJson(localJson, imageGateway)
      if (!fixedJson) throw new Error('buildWalletSafeJson failed')
      const jsonReceipt = await irys.upload(Buffer.from(JSON.stringify(fixedJson, null, 2), 'utf8'), {
        tags: [{ name: 'Content-Type', value: 'application/json' }],
      })
      const newUri = `https://gateway.irys.xyz/${String(jsonReceipt.id)}`
      const newName = step.onchainName.slice(0, 32)
      const newSymbol = String(localJson.symbol || (md.symbol || '').replace(/\0/g, '') || 'OWL2').slice(0, 10)

      let sigStr = null
      let lastErr = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await updateV1(umi, {
            mint: publicKey(step.mint),
            authority: umi.identity,
            data: some({
              name: newName,
              symbol: newSymbol,
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

      results.push({
        mint: step.mint,
        onchainNum: step.onchainNum,
        packFile: step.packFile,
        status: 'restored',
        onchainName: newName,
        jsonName: localJson.name,
        oneOne: oneOne(localJson.attributes),
        imageId: String(pngReceipt.id),
        newUri,
        signature: sigStr,
      })
      console.log(`OK    #${step.onchainNum} <- pack ${step.packFile} (${oneOne(localJson.attributes) || 'regular'}) ${sigStr}`)
      await sleep(800)
    } catch (e) {
      results.push({ mint: step.mint, onchainNum: step.onchainNum, status: 'error', error: String(e.message || e) })
      console.log(`FAIL  #${step.onchainNum} ${String(e.message || e)}`)
      await sleep(1500)
    }
  }

  const out = {
    restored_at: new Date().toISOString(),
    attempted: batch.length,
    restored: results.filter((r) => r.status === 'restored').length,
    failed: results.filter((r) => r.status !== 'restored').length,
    results,
  }
  fs.writeFileSync(path.join('scripts', '_restore-off-by-one-results.json'), JSON.stringify(out, null, 2))
  console.log('\nWrote scripts/_restore-off-by-one-results.json')
  console.log('Done.', { restored: out.restored, failed: out.failed })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
