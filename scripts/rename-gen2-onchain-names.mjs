/**
 * Rename Gen2 NFTs whose on-chain name is bare ("1364") to "Owltopia G2 #N".
 * Does not change URI/image — only the Metaplex name (what Orbis/ME usually show).
 *
 *   node --env-file=.env.local scripts/rename-gen2-onchain-names.mjs
 *   node --env-file=.env.local scripts/rename-gen2-onchain-names.mjs --execute
 *   node --env-file=.env.local scripts/rename-gen2-onchain-names.mjs --execute --max=50
 */
import fs from 'node:fs'
import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchMetadata, findMetadataPda, mplTokenMetadata, updateV1 } from '@metaplex-foundation/mpl-token-metadata'
import { createSignerFromKeypair, publicKey, signerIdentity, some } from '@metaplex-foundation/umi'

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
const COLLECTION = process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT?.trim()
const IRYS_KEY = process.env.IRYS_PRIVATE_KEY?.trim()

const TARGET_RE = /^Owltopia G2 #\d+$/
const PREFIX = 'Owltopia G2 #'

function parseArgs(argv) {
  const o = { execute: false, max: Infinity, concurrency: 1 }
  for (const a of argv) {
    if (a === '--execute') o.execute = true
    else if (a.startsWith('--max=')) o.max = Math.max(1, parseInt(a.slice(6), 10) || 0)
    else if (a.startsWith('--concurrency=')) o.concurrency = Math.max(1, Math.min(4, parseInt(a.slice(14), 10) || 1))
  }
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rpcCall(method, params, attempt = 0) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'rename', method, params }),
  })
  const j = await res.json()
  if (j.error) {
    if ((j.error.code === -32429 || /429|too many/i.test(JSON.stringify(j.error))) && attempt < 8) {
      await sleep(700 * (attempt + 1))
      return rpcCall(method, params, attempt + 1)
    }
    throw new Error(`${method}: ${JSON.stringify(j.error)}`)
  }
  return j.result
}

function desiredNameFromCurrent(name) {
  const raw = String(name || '').replace(/\0/g, '').trim()
  if (TARGET_RE.test(raw)) return null // already good
  // "Owltopia G2 #50", "Owltopia Gen2 #50", "G2 #50", "#50", "50", "1364"
  const m =
    raw.match(/#\s*(\d+)\s*$/) ||
    raw.match(/^(\d+)$/) ||
    raw.match(/(\d+)\s*$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 0) return null
  const next = `${PREFIX}${n}`
  if (next.length > 32) return null
  return next === raw ? null : next
}

async function listCollection() {
  const out = []
  for (let page = 1; page <= 50; page++) {
    const r = await rpcCall('getAssetsByGroup', {
      groupKey: 'collection',
      groupValue: COLLECTION,
      page,
      limit: 1000,
    })
    const items = r.items ?? []
    if (!items.length) break
    for (const a of items) {
      const name = a.content?.metadata?.name || ''
      out.push({ mint: a.id, name })
    }
    if (items.length < 1000) break
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!RPC || !COLLECTION || !IRYS_KEY) {
    console.error('Missing RPC / COLLECTION / IRYS_PRIVATE_KEY')
    process.exit(1)
  }

  console.log(`Mode: ${args.execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Collection: ${COLLECTION}`)
  console.log('Listing via DAS...')
  const listed = await listCollection()
  const candidates = []
  for (const row of listed) {
    const next = desiredNameFromCurrent(row.name)
    if (next) candidates.push({ ...row, next })
  }
  const todo = candidates.slice(0, args.max === Infinity ? undefined : args.max)
  console.log(`Total: ${listed.length}; need rename: ${candidates.length}; processing: ${todo.length}\n`)

  if (todo.length === 0) {
    console.log('Nothing to do.')
    return
  }

  const secret = IRYS_KEY.startsWith('[')
    ? Uint8Array.from(JSON.parse(IRYS_KEY).slice(0, 64))
    : bs58.decode(IRYS_KEY)
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplTokenMetadata())
  const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret))
  umi.use(signerIdentity(signer))
  const signerAddr = String(umi.identity.publicKey)
  console.log(`Signer: ${signerAddr}`)

  let fixed = 0
  let skipped = 0
  let failed = 0
  const results = []

  for (const item of todo) {
    try {
      if (!args.execute) {
        fixed++
        results.push({ mint: item.mint, status: 'dry', from: item.name, to: item.next })
        console.log(`DRY   ${item.mint}  "${item.name}" -> "${item.next}"`)
        continue
      }

      const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(item.mint) }))
      if (String(md.updateAuthority) !== signerAddr) {
        failed++
        results.push({ mint: item.mint, status: 'authority_mismatch' })
        console.log(`SKIP  ${item.mint}  authority_mismatch`)
        continue
      }
      const current = (md.name || '').replace(/\0/g, '').trim()
      const next = desiredNameFromCurrent(current) || item.next
      if (!next || next === current) {
        skipped++
        console.log(`SAFE  ${item.mint}  already "${current}"`)
        continue
      }

      let lastErr = null
      let sig = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await updateV1(umi, {
            mint: publicKey(item.mint),
            authority: umi.identity,
            data: some({
              name: next,
              symbol: (md.symbol || '').replace(/\0/g, '') || 'OWL2',
              uri: (md.uri || '').replace(/\0/g, '').trim(),
              sellerFeeBasisPoints: md.sellerFeeBasisPoints,
              creators: md.creators,
            }),
          }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
          sig = typeof res.signature === 'string' ? res.signature : bs58.encode(res.signature)
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          await sleep(1500 * (attempt + 1))
        }
      }
      if (lastErr) throw lastErr

      fixed++
      results.push({ mint: item.mint, status: 'fixed', from: current, to: next, signature: sig })
      console.log(`FIX   ${item.mint}  "${current}" -> "${next}"  ${sig}`)
      await sleep(850)
    } catch (e) {
      failed++
      results.push({ mint: item.mint, status: 'error', error: String(e.message || e) })
      console.log(`FAIL  ${item.mint}  ${String(e.message || e)}`)
      await sleep(2000)
    }
  }

  const summary = {
    scanned_at: new Date().toISOString(),
    total: listed.length,
    need_rename: candidates.length,
    processed: todo.length,
    fixed,
    skipped,
    failed,
    results,
  }
  fs.writeFileSync('scripts/_gen2-rename-results.json', JSON.stringify(summary, null, 2))
  console.log('\nDone.', { fixed, skipped, failed, need_rename: candidates.length })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
