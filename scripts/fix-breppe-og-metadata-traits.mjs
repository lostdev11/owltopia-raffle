/**
 * Breppe OG metadata trait cleanup (Core assets).
 *
 * Audit / dry-run (default, no writes):
 *   node --env-file=.env.local scripts/fix-breppe-og-metadata-traits.mjs
 *   node scripts/fix-breppe-og-metadata-traits.mjs --me-only
 *   node scripts/fix-breppe-og-metadata-traits.mjs --zip=/path/to/breppe-og.zip
 *   node scripts/fix-breppe-og-metadata-traits.mjs --write-plan=scripts/_breppe-og-trait-plan.json
 *
 * Execute (Irys JSON upload + mpl-core URI update) — requires prior plan file:
 *   node --env-file=.env.local scripts/fix-breppe-og-metadata-traits.mjs \
 *     --execute --plan=scripts/_breppe-og-trait-plan.json
 *
 * Correction map (Baza 2026-09):
 *   Eyeweare → Eyewear
 *   Eyes: Intence→Intense, Pot Leave→Pot Leaf
 *   Body: Blue Suite→Blue Suit
 *   Eyewear: Rayban→Ray-Ban
 *   Hand: Iphone→iPhone
 *   Mouth (from original value only): Brasses→rainbow, Rainbow→drewl
 *   OG #68: upsert Beard / Brown Beard if missing
 *
 * Mouth remaps are NOT idempotent if re-inferred from live `rainbow`.
 * Always execute from a frozen --plan file written by a dry-run.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchAsset, fetchCollection, mplCore, update } from '@metaplex-foundation/mpl-core'
import { createSignerFromKeypair, publicKey, signerIdentity } from '@metaplex-foundation/umi'

const COLLECTION = (
  process.env.BREPPE_OG_COLLECTION_MINT || 'BocivH3hnJLnsfpfrabcHb8Focdv4gMSZcsiN1sBLZ11'
).trim()
const ME_SYMBOL = (process.env.BREPPE_OG_ME_SYMBOL || 'breppe_og').trim()
const RPC = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || '').trim()
const IRYS_KEY = (process.env.IRYS_PRIVATE_KEY || '').trim()
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const PROXY_MARKER = '/api/proxy-image'
const ALLOWED_MOUTH_AFTER = new Set(['drewl', 'rainbow', 'gold', 'golden', 'diamond'])

const TRAIT_TYPE_RENAMES = new Map([['eyeweare', 'Eyewear']])

/** Exact value renames after trait_type normalize. Keys: `${typeLower}::${valueLower}` */
const VALUE_RENAMES = new Map([
  ['eyes::intence', 'Intense'],
  ['eyes::pot leave', 'Pot Leaf'],
  ['body::blue suite', 'Blue Suit'],
  ['eyewear::rayban', 'Ray-Ban'],
  ['hand::iphone', 'iPhone'],
])

/** Mouth chain from ORIGINAL value only (case-insensitive). */
const MOUTH_RENAMES = new Map([
  ['brasses', 'rainbow'],
  ['rainbow', 'drewl'],
])

function parseArgs(argv) {
  const o = {
    execute: false,
    meOnly: false,
    zip: null,
    writePlan: 'scripts/_breppe-og-trait-plan.json',
    plan: null,
    limit: Infinity,
    concurrency: 6,
  }
  for (const a of argv) {
    if (a === '--execute') o.execute = true
    else if (a === '--me-only') o.meOnly = true
    else if (a.startsWith('--zip=')) o.zip = a.slice(6).replace(/^["']|["']$/g, '')
    else if (a.startsWith('--write-plan=')) o.writePlan = a.slice(13)
    else if (a.startsWith('--plan=')) o.plan = a.slice(7)
    else if (a.startsWith('--limit=')) o.limit = Math.max(1, parseInt(a.slice(8), 10) || 1)
    else if (a.startsWith('--concurrency=')) o.concurrency = Math.max(1, parseInt(a.slice(14), 10) || 6)
  }
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function normType(t) {
  return String(t ?? '').trim()
}
function normVal(v) {
  return String(v ?? '').trim()
}
function keyType(t) {
  return normType(t).toLowerCase()
}
function keyVal(v) {
  return normVal(v).toLowerCase()
}

function tokenNum(name) {
  const m = String(name || '').match(/#\s*(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : null
}

function attrsFromJson(json) {
  const attrs = json?.attributes
  return Array.isArray(attrs) ? attrs.map((a) => ({ trait_type: normType(a?.trait_type), value: normVal(a?.value) })) : []
}

function attrsFromDas(item) {
  const attrs = item?.content?.metadata?.attributes
  if (Array.isArray(attrs) && attrs.length) {
    return attrs.map((a) => ({ trait_type: normType(a?.trait_type), value: normVal(a?.value) }))
  }
  return []
}

/**
 * Apply correction map. Returns { attributes, rules[] } where rules lists applied rule ids.
 * Mouth uses original values only (no sequential double-map).
 */
function patchAttributes(attrs, { tokenNumber } = {}) {
  const rules = []
  const next = attrs.map((a) => ({ trait_type: a.trait_type, value: a.value }))

  for (const a of next) {
    const kt = keyType(a.trait_type)
    if (TRAIT_TYPE_RENAMES.has(kt)) {
      const to = TRAIT_TYPE_RENAMES.get(kt)
      if (a.trait_type !== to) {
        rules.push(`type:${a.trait_type}->${to}`)
        a.trait_type = to
      }
    }
  }

  for (const a of next) {
    const kt = keyType(a.trait_type)
    if (kt === 'mouth') {
      const kv = keyVal(a.value)
      if (MOUTH_RENAMES.has(kv)) {
        const to = MOUTH_RENAMES.get(kv)
        if (a.value !== to) {
          rules.push(`mouth:${a.value}->${to}`)
          a.value = to
        }
      }
      continue
    }
    const vk = `${kt}::${keyVal(a.value)}`
    if (VALUE_RENAMES.has(vk)) {
      const to = VALUE_RENAMES.get(vk)
      if (a.value !== to) {
        rules.push(`value:${a.trait_type}:${a.value}->${to}`)
        a.value = to
      }
    }
  }

  if (tokenNumber === 68) {
    const hasBeard = next.some((a) => keyType(a.trait_type) === 'beard')
    if (!hasBeard) {
      next.push({ trait_type: 'Beard', value: 'Brown Beard' })
      rules.push('beard:#68:Brown Beard')
    }
  }

  return { attributes: next, rules }
}

function attrsEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].trait_type !== b[i].trait_type || a[i].value !== b[i].value) return false
  }
  return true
}

function arweaveTxId(url) {
  try {
    const u = new URL(String(url).trim())
    if (u.pathname.includes('proxy-image')) {
      const inner = u.searchParams.get('url')
      if (inner) return arweaveTxId(inner)
    }
    return u.pathname.replace(/^\//, '').split('/')[0] || null
  } catch {
    return null
  }
}

function imageUrlFromJson(json) {
  if (typeof json?.image === 'string' && json.image.trim()) return json.image.trim()
  const files = json?.properties?.files
  if (Array.isArray(files)) {
    for (const f of files) {
      if (f && typeof f.uri === 'string' && f.uri.trim()) return f.uri.trim()
    }
  }
  return null
}

/** Keep existing wallet-safe shape when present; otherwise leave image fields alone. */
function withPatchedAttributes(json, attributes) {
  const out = { ...json, attributes }
  const image = imageUrlFromJson(json)
  if (!image) return out
  // If already wallet-safe, preserve; if raw irys/arweave, optionally wrap like other Owl scripts.
  if (image.includes(PROXY_MARKER)) return out
  const id = arweaveTxId(image)
  if (!id) return out
  const gatewayBase = `https://gateway.irys.xyz/${id}`
  const gatewayImage = `${gatewayBase}?ext=png`
  const primaryImage = `${SITE_URL}/api/proxy-image?url=${encodeURIComponent(gatewayBase)}`
  out.image = primaryImage
  const props = json.properties && typeof json.properties === 'object' ? { ...json.properties } : {}
  props.files = [
    { uri: primaryImage, type: 'image/png', cdn: true },
    { uri: gatewayImage, type: 'image/png' },
  ]
  props.category = 'image'
  out.properties = props
  return out
}

async function fetchJson(uri) {
  if (!uri) return { error: 'no_uri' }
  const hosts = [
    uri,
    uri.replace('https://arweave.net/', 'https://gateway.irys.xyz/'),
    uri.replace('https://gateway.irys.xyz/', 'https://arweave.net/'),
  ]
  for (const u of [...new Set(hosts)]) {
    try {
      const r = await fetch(u, {
        signal: AbortSignal.timeout(25000),
        headers: { 'User-Agent': 'BreppeTraitFix/1.0' },
      })
      const text = await r.text()
      if (!r.ok) continue
      if (text.trimStart().startsWith('<')) continue
      if (!text.trimStart().startsWith('{')) continue
      return { uri: u, json: JSON.parse(text) }
    } catch {
      /* next */
    }
  }
  return { error: 'fetch_failed', uri }
}

async function rpcCall(method, params, attempt = 0) {
  if (!RPC) throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL required for DAS/RPC')
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'breppe', method, params }),
  })
  const j = await res.json()
  if (j.error) {
    if ((j.error.code === -32429 || j.error.code === 429) && attempt < 6) {
      await sleep(800 * (attempt + 1))
      return rpcCall(method, params, attempt + 1)
    }
    throw new Error(`${method}: ${JSON.stringify(j.error)}`)
  }
  return j.result
}

async function listCollectionViaDas() {
  const out = []
  for (let page = 1; page <= 50; page++) {
    const r = await rpcCall('getAssetsByGroup', {
      groupKey: 'collection',
      groupValue: COLLECTION,
      page,
      limit: 1000,
      displayOptions: { showCollectionMetadata: false },
    })
    const items = r?.items ?? []
    if (!items.length) break
    for (const a of items) {
      const name = a?.content?.metadata?.name || a?.content?.json_uri || a.id
      out.push({
        mint: a.id,
        name: String(name || ''),
        uri: a?.content?.json_uri || null,
        attributes: attrsFromDas(a),
        source: 'das',
      })
    }
    if (items.length < 1000) break
  }
  return out
}

async function meGet(url, attempt = 0) {
  const r = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'BreppeTraitFix/1.0' },
    signal: AbortSignal.timeout(30000),
  })
  if ((r.status === 429 || r.status >= 500) && attempt < 8) {
    await sleep(1000 * (attempt + 1))
    return meGet(url, attempt + 1)
  }
  if (!r.ok) throw new Error(`ME ${r.status} ${url}`)
  return r.json()
}

/** Hydrate name/uri/attributes via mpl-core fetchAsset (works on public RPC; no DAS). */
async function hydrateViaCoreRpc(assets, { concurrency }) {
  const rpc = RPC || 'https://api.mainnet-beta.solana.com'
  const umi = createUmi(rpc, { commitment: 'confirmed' }).use(mplCore())
  let done = 0
  await pool(assets, concurrency, async (row) => {
    try {
      const asset = await fetchAsset(umi, publicKey(row.mint), { skipDerivePlugins: true })
      row.name = String(asset.name || row.name || '')
      row.uri = String(asset.uri || row.uri || '')
      if (row.uri) {
        const fetched = await fetchJson(row.uri)
        if (fetched.json) {
          row.attributes = attrsFromJson(fetched.json)
          if (!row.name && fetched.json.name) row.name = fetched.json.name
          row.source = `${row.source || 'mint'}+core-json`
        }
      }
    } catch (e) {
      row.core_error = String(e.message || e)
    }
    done++
    if (done % 25 === 0) console.log(`  core hydrate ${done}/${assets.length}`)
  })
}

/** Discover mints via Magic Eden listings + activities, then hydrate token metadata. */
async function listCollectionViaMagicEden({ concurrency }) {
  const byMint = new Map()

  for (let offset = 0; offset < 500; offset += 20) {
    const data = await meGet(
      `https://api-mainnet.magiceden.dev/v2/collections/${ME_SYMBOL}/listings?offset=${offset}&limit=20`
    )
    if (!Array.isArray(data) || !data.length) break
    for (const it of data) {
      const mint = it.tokenMint
      const tok = it.token || {}
      if (!mint) continue
      byMint.set(mint, {
        mint,
        name: tok.name || null,
        uri: null,
        attributes: Array.isArray(tok.attributes)
          ? tok.attributes.map((a) => ({ trait_type: normType(a.trait_type), value: normVal(a.value) }))
          : [],
        image: tok.image || null,
        source: 'me-listing',
      })
    }
    if (data.length < 20) break
    await sleep(250)
  }

  for (let offset = 0; offset < 5000; offset += 500) {
    let data
    try {
      data = await meGet(
        `https://api-mainnet.magiceden.dev/v2/collections/${ME_SYMBOL}/activities?offset=${offset}&limit=500`
      )
    } catch {
      break
    }
    if (!Array.isArray(data) || !data.length) break
    for (const it of data) {
      const mint = it.tokenMint || it.mint
      if (!mint || byMint.has(mint)) continue
      byMint.set(mint, {
        mint,
        name: null,
        uri: null,
        attributes: [],
        image: null,
        source: 'me-activity',
      })
    }
    await sleep(350)
  }

  const list = [...byMint.values()]
  console.log(`ME discovery: ${list.length} mints (skipping ME token hydrate; use Core URI JSON)`)
  return list
}

function unpackZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  execSync(`unzip -qo ${JSON.stringify(zipPath)} -d ${JSON.stringify(destDir)}`, { stdio: 'inherit' })
}

function findJsonAssets(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let ents
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of ents) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === '__MACOSX' || ent.name === 'node_modules') continue
        stack.push(p)
      } else if (/^\d+\.json$/i.test(ent.name)) {
        out.push(p)
      }
    }
  }
  return out.sort((a, b) => {
    const na = parseInt(path.basename(a), 10)
    const nb = parseInt(path.basename(b), 10)
    return na - nb
  })
}

function auditZip(zipPath) {
  const dest = path.join('/tmp', `breppe-og-zip-${Date.now()}`)
  console.log(`Unpacking ${zipPath} → ${dest}`)
  unpackZip(zipPath, dest)
  const files = findJsonAssets(dest)
  console.log(`Found ${files.length} numbered JSON files`)

  const mouth = new Map()
  const typeHist = new Map()
  const wouldChange = []
  const ruleCounts = new Map()

  for (const file of files) {
    const n = parseInt(path.basename(file), 10)
    let json
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      console.warn(`skip ${file}: ${e.message}`)
      continue
    }
    const before = attrsFromJson(json)
    for (const a of before) {
      typeHist.set(a.trait_type, (typeHist.get(a.trait_type) || 0) + 1)
      if (keyType(a.trait_type) === 'mouth') {
        mouth.set(a.value, (mouth.get(a.value) || 0) + 1)
      }
    }
    const { attributes: after, rules } = patchAttributes(before, { tokenNumber: n })
    if (!attrsEqual(before, after)) {
      wouldChange.push({
        file,
        index: n,
        name: json.name || `Breppe OG #${n}`,
        before,
        after,
        rules,
      })
      for (const r of rules) ruleCounts.set(r, (ruleCounts.get(r) || 0) + 1)
    }
  }

  console.log('\n=== ZIP Mouth histogram ===')
  for (const [k, v] of [...mouth.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }
  console.log('\n=== ZIP trait_type histogram (top) ===')
  for (const [k, v] of [...typeHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${k}: ${v}`)
  }
  console.log(`\nZIP assets that would change: ${wouldChange.length}`)
  for (const [k, v] of [...ruleCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  rule ${k}: ${v}`)
  }

  const reportPath = 'scripts/_breppe-og-zip-audit.json'
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        audited_at: new Date().toISOString(),
        zip: zipPath,
        json_count: files.length,
        mouth_histogram: Object.fromEntries(mouth),
        would_change: wouldChange.length,
        rule_counts: Object.fromEntries(ruleCounts),
        samples: wouldChange.slice(0, 25),
      },
      null,
      2
    )
  )
  console.log(`Wrote ${reportPath}`)
  return { files, wouldChange, mouth, dest }
}

function histogramMouth(assets) {
  const h = new Map()
  for (const a of assets) {
    const mouth = (a.attributes || []).find((x) => keyType(x.trait_type) === 'mouth')
    const v = mouth ? mouth.value : '(missing)'
    h.set(v, (h.get(v) || 0) + 1)
  }
  return h
}

function buildPlanEntries(assets) {
  const entries = []
  const ruleCounts = new Map()
  for (const a of assets) {
    const n = tokenNum(a.name)
    const before = a.attributes || []
    const { attributes: after, rules } = patchAttributes(before, { tokenNumber: n })
    if (!rules.length && attrsEqual(before, after)) continue
    if (!attrsEqual(before, after)) {
      for (const r of rules) ruleCounts.set(r, (ruleCounts.get(r) || 0) + 1)
      entries.push({
        mint: a.mint,
        name: a.name,
        token_number: n,
        uri: a.uri || null,
        before,
        after,
        rules,
        source: a.source,
      })
    }
  }
  return { entries, ruleCounts }
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < items.length) {
        const idx = i++
        results[idx] = await worker(items[idx], idx)
      }
    })
  )
  return results
}

function parseIrysSecret(raw) {
  if (raw.startsWith('[')) return Uint8Array.from(JSON.parse(raw).slice(0, 64))
  return bs58.decode(raw)
}

async function executePlan(planPath) {
  if (!RPC || !IRYS_KEY) {
    throw new Error('Execute requires NEXT_PUBLIC_SOLANA_RPC_URL and IRYS_PRIVATE_KEY')
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  const entries = plan.entries || []
  if (!entries.length) {
    console.log('Plan has zero entries — nothing to do.')
    return { results: [] }
  }

  const { Uploader } = await import('@irys/upload')
  const { Solana } = await import('@irys/upload-solana')

  const secret = parseIrysSecret(IRYS_KEY)
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplCore())
  const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret))
  umi.use(signerIdentity(signer))
  const signerAddr = String(umi.identity.publicKey)
  console.log(`Signer: ${signerAddr}`)

  const collection = await fetchCollection(umi, publicKey(COLLECTION))
  const updateAuthority = String(collection.updateAuthority)
  const delegates = (collection.updateDelegate?.additionalDelegates ?? []).map(String)
  const allowed = updateAuthority === signerAddr || delegates.includes(signerAddr)
  if (!allowed) {
    throw new Error(
      `UA mismatch: collection UA=${updateAuthority}, signer=${signerAddr}, delegates=${delegates.join(',')}`
    )
  }

  const irys = await Uploader(Solana).withWallet(IRYS_KEY).withRpc(RPC)
  try {
    const price = await irys.getPrice(entries.length * 2000)
    const bal = await irys.getLoadedBalance()
    console.log(`Irys balance=${bal} quoted~${price} for ~${entries.length} JSONs`)
    if (BigInt(String(bal)) < BigInt(String(price))) {
      const topUp = BigInt(String(price)) - BigInt(String(bal))
      console.log(`Funding Irys ~${topUp}...`)
      await irys.fund(Number(topUp), 1.3)
    }
  } catch (e) {
    console.warn('Irys fund best-effort:', String(e.message || e))
  }

  const results = []
  for (const step of entries) {
    const label = step.name || step.mint
    try {
      const asset = await fetchAsset(umi, publicKey(step.mint), { skipDerivePlugins: true })
      const currentUri = String(asset.uri || '')
      const fetched = await fetchJson(currentUri)
      if (fetched.error || !fetched.json) {
        results.push({ mint: step.mint, name: label, status: 'json_fetch_failed', error: fetched.error })
        console.log(`FAIL  ${label} json_fetch_failed`)
        continue
      }

      // Re-apply ONLY the frozen plan's `after` attributes (do not re-infer Mouth).
      const patched = withPatchedAttributes(fetched.json, step.after)
      // Keep on-chain display name
      if (asset.name && !patched.name) patched.name = String(asset.name)

      const jsonReceipt = await irys.upload(Buffer.from(JSON.stringify(patched), 'utf8'), {
        tags: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'App-Name', value: 'Breppe-OG-Trait-Fix' },
        ],
      })
      const newUri = `https://gateway.irys.xyz/${String(jsonReceipt.id)}`

      let sigStr = null
      let lastErr = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await update(umi, {
            asset,
            collection,
            uri: newUri,
          }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
          sigStr = typeof res.signature === 'string' ? res.signature : bs58.encode(res.signature)
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          await sleep(2000 * (attempt + 1))
        }
      }
      if (lastErr) {
        results.push({
          mint: step.mint,
          name: label,
          status: 'update_failed',
          error: String(lastErr.message || lastErr),
          newUri,
        })
        console.log(`FAIL  ${label} ${String(lastErr.message || lastErr)}`)
        continue
      }

      results.push({
        mint: step.mint,
        name: label,
        status: 'updated',
        rules: step.rules,
        newUri,
        signature: sigStr,
      })
      console.log(`OK    ${label} uri=${newUri} sig=${sigStr}`)
      await sleep(700)
    } catch (e) {
      results.push({ mint: step.mint, name: label, status: 'error', error: String(e.message || e) })
      console.log(`FAIL  ${label} ${String(e.message || e)}`)
    }
  }

  const outPath = 'scripts/_breppe-og-trait-execute-results.json'
  fs.writeFileSync(
    outPath,
    JSON.stringify({ executed_at: new Date().toISOString(), collection: COLLECTION, results }, null, 2)
  )
  console.log(`Wrote ${outPath}`)
  console.log(
    'Summary:',
    results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1
      return acc
    }, {})
  )
  console.log('\nNotify Baza before card print — metadata URIs updated.')
  return { results }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (process.argv.includes('--self-test')) {
    // Mouth one-pass + spelling + #68 beard
    const r1 = patchAttributes(
      [
        { trait_type: 'Eyeweare', value: 'Rayban' },
        { trait_type: 'Mouth', value: 'Brasses' },
        { trait_type: 'Hand', value: 'Iphone' },
      ],
      { tokenNumber: 1 }
    )
    if (r1.attributes.find((a) => a.trait_type === 'Eyewear')?.value !== 'Ray-Ban') throw new Error('eyewear')
    if (r1.attributes.find((a) => a.trait_type === 'Mouth')?.value !== 'rainbow') throw new Error('brasses')
    if (r1.attributes.find((a) => a.trait_type === 'Hand')?.value !== 'iPhone') throw new Error('iphone')
    const r2 = patchAttributes([{ trait_type: 'Mouth', value: 'Rainbow' }], { tokenNumber: 2 })
    if (r2.attributes[0].value !== 'drewl') throw new Error('rainbow->drewl')
    // Must not double-map: applying patch to already-fixed rainbow must still map (non-idempotent) —
    // plan-file execute avoids re-inference; document expected behavior:
    const r3 = patchAttributes([{ trait_type: 'Mouth', value: 'rainbow' }], {})
    if (r3.attributes[0].value !== 'drewl') throw new Error('lowercase rainbow still maps — use frozen plan')
    const r4 = patchAttributes(
      [
        { trait_type: 'Mouth', value: 'Golden' },
        { trait_type: 'Eyes', value: 'Intence' },
      ],
      { tokenNumber: 68 }
    )
    if (r4.attributes.find((a) => a.trait_type === 'Mouth')?.value !== 'Golden') throw new Error('golden')
    if (!r4.attributes.some((a) => a.trait_type === 'Beard' && a.value === 'Brown Beard')) throw new Error('beard')
    if (r4.attributes.find((a) => a.trait_type === 'Eyes')?.value !== 'Intense') throw new Error('intense')
    console.log('self-test OK')
    return
  }
  console.log(`Collection: ${COLLECTION}`)
  console.log(`Mode: ${args.execute ? 'EXECUTE' : 'DRY RUN / AUDIT'}`)

  if (args.zip) {
    if (!fs.existsSync(args.zip)) {
      console.error(`Zip not found: ${args.zip}`)
      process.exit(1)
    }
    auditZip(args.zip)
    if (!args.execute && !args.meOnly && !RPC) {
      console.log('\nZip audit complete. Pass DAS RPC or --me-only for live collection plan.')
      return
    }
  }

  if (args.execute) {
    const planPath = args.plan || args.writePlan
    if (!planPath || !fs.existsSync(planPath)) {
      console.error('Execute requires an existing --plan= file from a prior dry-run.')
      process.exit(1)
    }
    await executePlan(planPath)
    return
  }

  let assets = []
  if (!args.meOnly && RPC) {
    try {
      console.log('Listing via DAS getAssetsByGroup...')
      assets = await listCollectionViaDas()
      console.log(`DAS returned ${assets.length} assets`)
    } catch (e) {
      console.warn(`DAS failed (${e.message || e}); falling back to Magic Eden`)
      assets = []
    }
  }
  if (!assets.length) {
    console.log('Listing via Magic Eden (listings + activities + token hydrate)...')
    assets = await listCollectionViaMagicEden({ concurrency: Math.min(3, args.concurrency) })
    console.log(`ME returned ${assets.length} unique mints`)
  }

  // Fill thin/missing attributes via Core account URI → Irys JSON (public RPC works).
  const thin = assets.filter((a) => !a.attributes || a.attributes.length < 3 || !a.attributes.some((x) => keyType(x.trait_type) === 'mouth'))
  if (thin.length) {
    console.log(`Hydrating ${thin.length} assets via mpl-core fetchAsset + metadata JSON...`)
    await hydrateViaCoreRpc(thin, { concurrency: Math.min(4, args.concurrency) })
  }

  // Prefer URI JSON attributes when DAS/ME attrs look thin — hydrate from json_uri when present
  const needHydrate = assets.filter((a) => a.uri && (!a.attributes || a.attributes.length < 3))
  if (needHydrate.length) {
    console.log(`Hydrating ${needHydrate.length} assets from json URI...`)
    await pool(needHydrate, Math.min(4, args.concurrency), async (row) => {
      const fetched = await fetchJson(row.uri)
      if (fetched.json) {
        row.attributes = attrsFromJson(fetched.json)
        if (!row.name && fetched.json.name) row.name = fetched.json.name
      }
    })
  }

  if (Number.isFinite(args.limit)) assets = assets.slice(0, args.limit)

  const mouthBefore = histogramMouth(assets)
  console.log('\n=== Live Mouth histogram (before) ===')
  for (const [k, v] of [...mouthBefore.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  const { entries, ruleCounts } = buildPlanEntries(assets)

  // Simulate after histogram
  const afterAssets = assets.map((a) => {
    const hit = entries.find((e) => e.mint === a.mint)
    return hit ? { ...a, attributes: hit.after } : a
  })
  const mouthAfter = histogramMouth(afterAssets)
  console.log('\n=== Live Mouth histogram (after proposed) ===')
  for (const [k, v] of [...mouthAfter.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  const unexpected = [...mouthAfter.keys()].filter((k) => {
    if (k === '(missing)') return true
    return !ALLOWED_MOUTH_AFTER.has(String(k).toLowerCase())
  })
  if (unexpected.length) {
    console.warn('\nWARNING: unexpected Mouth values after patch:', unexpected.join(', '))
  }

  console.log(`\nMints that would change: ${entries.length}`)
  for (const [k, v] of [...ruleCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  const plan = {
    created_at: new Date().toISOString(),
    collection: COLLECTION,
    discovery: assets[0]?.source?.startsWith('me') ? 'magiceden' : 'das',
    asset_count: assets.length,
    change_count: entries.length,
    mouth_before: Object.fromEntries(mouthBefore),
    mouth_after: Object.fromEntries(mouthAfter),
    rule_counts: Object.fromEntries(ruleCounts),
    entries,
    note: 'Execute with --execute --plan=<this file>. Do not re-infer Mouth from live rainbow after first pass.',
    notify: 'Ping Baza after execute before card print.',
  }

  const out = args.writePlan || 'scripts/_breppe-og-trait-plan.json'
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(plan, null, 2))
  console.log(`\nWrote plan ${out}`)
  console.log('Dry run only. Re-run with --execute --plan=... after review.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
