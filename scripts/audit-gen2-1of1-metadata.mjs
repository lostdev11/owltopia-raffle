/**
 * Read-only audit: compare official pack 1/1s to live on-chain metadata.
 * Does not write any on-chain updates.
 *
 *   node --env-file=.env.local scripts/audit-gen2-1of1-metadata.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplTokenMetadata, fetchDigitalAsset } from '@metaplex-foundation/mpl-token-metadata'
import { publicKey } from '@metaplex-foundation/umi'

const COLLECTION = 'GkLgT4KuwAPKeMSzfcPPmzuGimRNPvK1FWNPks4kzFVA'
const rpc = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || '').trim()
if (!rpc) throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL required')

const packOnes = JSON.parse(readFileSync('scripts/_audit-pack-1of1.json', 'utf8'))
const rename = JSON.parse(readFileSync('scripts/_gen2-rename-results.json', 'utf8'))
const broken = existsSync('scripts/_gen2-broken-images.json')
  ? JSON.parse(readFileSync('scripts/_gen2-broken-images.json', 'utf8'))
  : { items: [] }
const fixed = existsSync('scripts/_gen2-local-assets-fix-results.json')
  ? JSON.parse(readFileSync('scripts/_gen2-local-assets-fix-results.json', 'utf8'))
  : { results: [] }

function tokenNum(s) {
  const m = String(s || '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

const byNum = new Map()
for (const it of rename.results || []) {
  const n = tokenNum(it.to) ?? tokenNum(it.from)
  if (n && it.mint) byNum.set(n, { mint: it.mint, from: it.from, to: it.to })
}
for (const it of broken.items || []) {
  const n = tokenNum(it.name)
  if (!n) continue
  const cur = byNum.get(n) || {}
  byNum.set(n, {
    ...cur,
    mint: cur.mint || it.mint,
    oldJson: it.json_uri,
    oldImage: it.image,
    wasBroken: true,
  })
}
for (const it of fixed.results || []) {
  const n = tokenNum(it.name)
  if (!n) continue
  const cur = byNum.get(n) || {}
  byNum.set(n, {
    ...cur,
    mint: cur.mint || it.mint,
    newUri: it.newUri,
    wasFixedLocal: true,
  })
}

const umi = createUmi(rpc).use(mplTokenMetadata())

async function fetchJson(uri) {
  if (!uri) return { error: 'no uri' }
  const hosts = [
    uri,
    uri.replace('https://arweave.net/', 'https://gateway.irys.xyz/'),
    uri.replace('https://gateway.irys.xyz/', 'https://arweave.net/'),
  ]
  for (const u of [...new Set(hosts)]) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) })
      const ct = r.headers.get('content-type') || ''
      const text = await r.text()
      if (!r.ok) continue
      if (text.trimStart().startsWith('<')) continue
      if (!ct.includes('json') && !text.trimStart().startsWith('{')) continue
      return { uri: u, json: JSON.parse(text) }
    } catch {
      /* try next */
    }
  }
  return { error: 'fetch_failed', uri }
}

function oneOneTrait(attrs) {
  if (!Array.isArray(attrs)) return null
  const hit = attrs.find((a) => String(a.trait_type) === '1/1')
  return hit ? String(hit.value) : null
}

function ownerOf(mint) {
  return fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenLargestAccounts',
      params: [mint],
    }),
  })
    .then((r) => r.json())
    .then(async (j) => {
      const ata = j.result?.value?.[0]?.address
      if (!ata) return null
      const acc = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [ata, { encoding: 'jsonParsed' }],
        }),
      }).then((r) => r.json())
      return acc.result?.value?.data?.parsed?.info?.owner || null
    })
}

const rows = []
for (const o of packOnes) {
  const known = byNum.get(o.n)
  const mint = known?.mint
  const row = {
    token: o.n,
    packValue: o.value,
    mint: mint || null,
    wasBroken: !!known?.wasBroken,
    wasFixedLocal: !!known?.wasFixedLocal,
    oldJson: known?.oldJson || null,
  }
  if (!mint) {
    row.status = 'NO_MINT_MAP'
    rows.push(row)
    console.log(`#${o.n} ${o.value}: NO MINT MAP`)
    continue
  }

  try {
    const asset = await fetchDigitalAsset(umi, publicKey(mint))
    row.onchainName = asset.metadata.name
    row.onchainUri = asset.metadata.uri
    row.updateAuth = String(asset.metadata.updateAuthority)
    row.isMutable = asset.metadata.isMutable
    row.owner = await ownerOf(mint)

    const live = await fetchJson(asset.metadata.uri)
    if (live.json) {
      row.liveName = live.json.name
      row.liveOneOne = oneOneTrait(live.json.attributes)
      row.liveAttrs = live.json.attributes
      row.liveImage = live.json.image
    } else {
      row.liveFetchError = live.error
    }

    // Pre-repair JSON if we have old URI (may 404 on image but JSON sometimes survives)
    if (known?.oldJson) {
      const old = await fetchJson(known.oldJson)
      if (old.json) {
        row.oldName = old.json.name
        row.oldOneOne = oneOneTrait(old.json.attributes)
        row.oldAttrs = old.json.attributes
      } else {
        row.oldFetchError = old.error
      }
    }

    const liveIs = row.liveOneOne
    if (liveIs === o.value) row.status = 'MATCH_PACK'
    else if (liveIs && liveIs !== o.value) row.status = 'WRONG_1OF1'
    else if (!liveIs && row.liveFetchError) row.status = 'LIVE_URI_UNREADABLE'
    else row.status = 'MISSING_1OF1_TRAIT'

    console.log(
      `#${o.n} pack=${o.value} live=${liveIs || row.liveFetchError || 'none'} status=${row.status} owner=${(row.owner || '').slice(0, 8)}…`
    )
  } catch (e) {
    row.status = 'ERROR'
    row.error = e.message
    console.log(`#${o.n} ERROR`, e.message)
  }
  rows.push(row)
}

// Also: find any on-chain assets that currently claim a 1/1 but aren't in pack numbers
// (sample via DAS if available)
async function dasSearch() {
  const out = []
  let page = 1
  while (page <= 20) {
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAssetsByGroup',
        params: {
          groupKey: 'collection',
          groupValue: COLLECTION,
          page,
          limit: 1000,
        },
      }),
    }).then((x) => x.json())
    const items = r.result?.items || []
    if (!items.length) break
    for (const it of items) {
      const attrs = it.content?.metadata?.attributes || []
      const one = oneOneTrait(attrs)
      if (!one) continue
      const name = it.content?.metadata?.name || ''
      const n = tokenNum(name)
      out.push({
        mint: it.id,
        name,
        token: n,
        oneOne: one,
        owner: it.ownership?.owner || null,
      })
    }
    if (items.length < 1000) break
    page++
  }
  return out
}

let dasOnes = []
try {
  dasOnes = await dasSearch()
  console.log(`\nDAS found ${dasOnes.length} assets with 1/1 trait`)
} catch (e) {
  console.log('DAS scan failed:', e.message)
}

const packByValue = new Map(packOnes.map((o) => [o.value, o.n]))
const packByNum = new Map(packOnes.map((o) => [o.n, o.value]))

const dasIssues = []
for (const d of dasOnes) {
  const expected = d.token != null ? packByNum.get(d.token) : null
  if (expected && expected !== d.oneOne) {
    dasIssues.push({ ...d, issue: 'TOKEN_HAS_WRONG_1OF1', expected })
  } else if (d.token != null && !expected && d.oneOne) {
    dasIssues.push({ ...d, issue: '1OF1_ON_NON_PACK_TOKEN' })
  } else if (expected && expected === d.oneOne) {
    /* ok */
  } else if (d.token == null) {
    dasIssues.push({ ...d, issue: '1OF1_UNPARSED_NAME' })
  }
}

// missing pack 1/1s not seen in DAS
const dasNums = new Set(dasOnes.map((d) => d.token).filter(Boolean))
const missingOnDas = packOnes.filter((o) => !dasNums.has(o.n))

const report = {
  audited_at: new Date().toISOString(),
  pack_1of1_count: packOnes.length,
  pack_rows: rows,
  das_1of1_count: dasOnes.length,
  das_ones: dasOnes,
  das_issues: dasIssues,
  missing_on_das: missingOnDas,
  summary: {
    match_pack: rows.filter((r) => r.status === 'MATCH_PACK').length,
    wrong: rows.filter((r) => r.status === 'WRONG_1OF1').length,
    missing_trait: rows.filter((r) => r.status === 'MISSING_1OF1_TRAIT').length,
    unreadable: rows.filter((r) => r.status === 'LIVE_URI_UNREADABLE').length,
    no_mint: rows.filter((r) => r.status === 'NO_MINT_MAP').length,
    errors: rows.filter((r) => r.status === 'ERROR').length,
    das_issues: dasIssues.length,
  },
}

writeFileSync('scripts/_audit-1of1-report.json', JSON.stringify(report, null, 2))
console.log('\nSUMMARY', report.summary)
console.log('Wrote scripts/_audit-1of1-report.json')
