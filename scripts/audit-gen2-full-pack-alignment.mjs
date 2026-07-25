/**
 * Full-collection read-only audit: compare live DAS attributes to pack N vs N+1.
 *
 *   node --env-file=.env.local scripts/audit-gen2-full-pack-alignment.mjs --assets="..."
 *   node --env-file=.env.local scripts/audit-gen2-full-pack-alignment.mjs --assets="..." --sample=200
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const COLLECTION = 'GkLgT4KuwAPKeMSzfcPPmzuGimRNPvK1FWNPks4kzFVA'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()

function parseArgs(argv) {
  const o = { assets: null, sample: Infinity }
  for (const a of argv) {
    if (a.startsWith('--assets=')) o.assets = a.slice(9).replace(/^"|"$/g, '')
    else if (a.startsWith('--sample=')) o.sample = Math.max(1, parseInt(a.slice(9), 10) || 0)
  }
  return o
}

function tokenNum(name) {
  const m = String(name || '').match(/#(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function attrsKey(attrs) {
  return JSON.stringify(
    (attrs || [])
      .map((a) => [String(a.trait_type), String(a.value)])
      .sort((x, y) => x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]))
  )
}

function oneOne(attrs) {
  const hit = (attrs || []).find((a) => String(a.trait_type) === '1/1')
  return hit ? String(hit.value) : null
}

function resolveJsonPath(assetsDir, n) {
  const candidates = [
    path.join(assetsDir, 'New folder', `${n}.json`),
    path.join(assetsDir, 'new folder', `${n}.json`),
    path.join(assetsDir, `${n}.json`),
  ]
  return candidates.find((p) => fs.existsSync(p)) || null
}

function loadPack(assetsDir, n) {
  const p = resolveJsonPath(assetsDir, n)
  if (!p) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

async function fetchAllCollection() {
  const items = []
  for (let page = 1; page <= 30; page++) {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: COLLECTION, page, limit: 1000 },
      }),
    }).then((x) => x.json())
    const batch = r.result?.items || []
    if (!batch.length) break
    items.push(...batch)
    console.log(`DAS page ${page}: +${batch.length} (total ${items.length})`)
    if (batch.length < 1000) break
  }
  return items
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!RPC) throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL required')
  if (!args.assets || !fs.existsSync(args.assets)) throw new Error('--assets= required')

  // known prior repair cohorts
  let priorRestored = new Set()
  try {
    const water = require('./_restore-water-1of1-results.json')
    for (const r of water.results || []) if (r.status === 'restored') priorRestored.add(r.mint)
  } catch {}
  try {
    const obo = require('./_restore-off-by-one-results.json')
    for (const r of obo.results || []) if (r.status === 'restored') priorRestored.add(r.mint)
  } catch {}

  const all = await fetchAllCollection()
  const sliced = args.sample < all.length ? all.slice(0, args.sample) : all

  const summary = {
    scanned: 0,
    no_token: 0,
    match_Nplus1_OK: 0,
    match_N_SHIFTED: 0,
    match_neither: 0,
    missing_pack: 0,
    no_live_attrs: 0,
  }
  const shifted = []
  const neither = []
  const ones = []

  for (const it of sliced) {
    const name = it.content?.metadata?.name || ''
    const n = tokenNum(name)
    const attrs = it.content?.metadata?.attributes || []
    const mint = it.id
    const owner = it.ownership?.owner || null
    summary.scanned++

    if (n == null) {
      summary.no_token++
      continue
    }
    if (!attrs.length) {
      summary.no_live_attrs++
      continue
    }

    const packN = loadPack(args.assets, n)
    const packNp1 = loadPack(args.assets, n + 1)
    if (!packN && !packNp1) {
      summary.missing_pack++
      continue
    }

    const liveKey = attrsKey(attrs)
    const isNp1 = packNp1 && liveKey === attrsKey(packNp1.attributes)
    const isN = packN && liveKey === attrsKey(packN.attributes)
    const liveOne = oneOne(attrs)

    if (liveOne) {
      ones.push({
        mint,
        name,
        token: n,
        liveOne,
        packNOne: oneOne(packN?.attributes),
        packNp1One: oneOne(packNp1?.attributes),
        align: isNp1 ? 'N+1' : isN ? 'N' : 'neither',
        owner,
        priorRestored: priorRestored.has(mint),
      })
    }

    if (isNp1) summary.match_Nplus1_OK++
    else if (isN) {
      summary.match_N_SHIFTED++
      shifted.push({
        mint,
        name,
        token: n,
        liveOne,
        owner,
        priorRestored: priorRestored.has(mint),
        expectedPack: n + 1,
        expectedOne: oneOne(packNp1?.attributes),
      })
    } else {
      summary.match_neither++
      neither.push({
        mint,
        name,
        token: n,
        liveOne,
        liveAttrs: attrs,
        owner,
        priorRestored: priorRestored.has(mint),
      })
    }
  }

  const report = {
    audited_at: new Date().toISOString(),
    collection: COLLECTION,
    total_das: all.length,
    scanned: sliced.length,
    summary,
    ones,
    shifted_sample: shifted.slice(0, 50),
    shifted_count: shifted.length,
    neither_sample: neither.slice(0, 30),
    neither_count: neither.length,
    shifted_not_previously_restored: shifted.filter((s) => !s.priorRestored).length,
  }

  fs.writeFileSync(path.join('scripts', '_audit-full-pack-alignment.json'), JSON.stringify(report, null, 2))
  console.log('\nSUMMARY', summary)
  console.log('1/1s:', ones.length)
  for (const o of ones.sort((a, b) => a.token - b.token)) {
    console.log(
      `  #${o.token} ${o.liveOne} align=${o.align} packN=${o.packNOne || '-'} packN+1=${o.packNp1One || '-'} restored=${o.priorRestored}`
    )
  }
  console.log('still shifted (pack N):', shifted.length, '(not previously restored:', report.shifted_not_previously_restored, ')')
  console.log('match neither:', neither.length)
  console.log('Wrote scripts/_audit-full-pack-alignment.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
