/**
 * One-time backfill: re-point already-minted Gen2 NFTs (and the collection NFT) at wallet-safe
 * metadata so Solflare can render the art.
 *
 * Why: Sugar deployed the config-line JSON with `image: https://arweave.net/<txid>`, which 302-redirects
 * to a per-tx subdomain. Solflare's image pipeline doesn't follow that redirect, so it shows a grey
 * placeholder. We re-upload each JSON with the Owltopia proxy `image` (+ Irys gateway mirror in
 * properties.files) and `updateV1` the on-chain URI. Update authority = the IRYS signer, so the server
 * can sign. Idempotent — skips mints already wallet-safe.
 *
 * This mirrors lib/owl-center/metadata-json-fix.ts + wallet-safe-onchain-metadata.ts (the production
 * cron / confirm-mint path) so re-runs and the cron agree on what "already safe" means.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-gen2-wallet-safe-metadata.mjs            # dry run
 *   node --env-file=.env.local scripts/backfill-gen2-wallet-safe-metadata.mjs --execute  # write on-chain
 *   ... --execute --max=50 --concurrency=3
 */

import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchMetadata, findMetadataPda, mplTokenMetadata, updateV1 } from '@metaplex-foundation/mpl-token-metadata'
import { createSignerFromKeypair, publicKey, signerIdentity, some } from '@metaplex-foundation/umi'
import { Uploader } from '@irys/upload'
import { Solana } from '@irys/upload-solana'

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
const COLLECTION = process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT?.trim()
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const IRYS_KEY = process.env.IRYS_PRIVATE_KEY?.trim()
const PROXY_MARKER = '/api/proxy-image'

function parseArgs(argv) {
  const o = { execute: false, max: Infinity, concurrency: 3 }
  for (const a of argv) {
    if (a === '--execute') o.execute = true
    else if (a.startsWith('--max=')) o.max = Math.max(1, parseInt(a.slice(6), 10) || 0)
    else if (a.startsWith('--concurrency=')) o.concurrency = Math.max(1, Math.min(8, parseInt(a.slice(14), 10) || 3))
  }
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rpcCall(method, params, attempt = 0) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'backfill', method, params }),
  })
  const j = await res.json()
  if (j.error) {
    if (j.error.code === -32429 && attempt < 6) {
      await sleep(800 * (attempt + 1))
      return rpcCall(method, params, attempt + 1)
    }
    throw new Error(`${method}: ${JSON.stringify(j.error)}`)
  }
  return j.result
}

function arweaveTxId(url) {
  try {
    const id = new URL(String(url).trim()).pathname.replace(/^\//, '').split('/')[0]?.trim()
    return id || null
  } catch {
    return null
  }
}

function imageUrlFromJson(json) {
  if (typeof json.image === 'string' && json.image.trim()) return json.image.trim()
  const files = json.properties?.files
  if (Array.isArray(files)) {
    for (const f of files) {
      if (f && typeof f.uri === 'string' && f.uri.trim()) return f.uri.trim()
    }
  }
  return null
}

function isJsonWalletSafe(json) {
  const image = typeof json.image === 'string' ? json.image : ''
  if (!image.includes(PROXY_MARKER)) return false
  const files = json.properties?.files
  if (!Array.isArray(files) || files.length === 0) return false
  const first = files[0]
  if (!first || first.cdn !== true || typeof first.uri !== 'string' || !first.uri.includes(PROXY_MARKER)) return false
  const hasGatewayMirror = files.some(
    (f) => f && typeof f.uri === 'string' && f.uri.includes('gateway.irys.xyz') && f.uri.includes('ext=png')
  )
  return hasGatewayMirror
}

function buildWalletSafeJson(json) {
  const rawImage = imageUrlFromJson(json)
  const id = rawImage ? arweaveTxId(rawImage) : null
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

async function fetchJsonFromUri(uri) {
  const id = arweaveTxId(uri)
  const candidates = [...new Set([uri, id ? `https://arweave.net/${id}` : null, id ? `https://gateway.irys.xyz/${id}` : null].filter(Boolean))]
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
      if (!res.ok) continue
      return await res.json()
    } catch {
      /* try next */
    }
  }
  return null
}

async function listCollectionMints() {
  const out = []
  for (let page = 1; page <= 50; page++) {
    const r = await rpcCall('getAssetsByGroup', { groupKey: 'collection', groupValue: COLLECTION, page, limit: 1000 })
    const items = r.items ?? []
    if (items.length === 0) break
    for (const a of items) {
      const image = a.content?.links?.image ?? a.content?.files?.[0]?.uri
      out.push({ mint: a.id, indexedSafe: typeof image === 'string' && image.includes(PROXY_MARKER) })
    }
    if (items.length < 1000) break
  }
  return out
}

async function pool(items, concurrency, worker) {
  const results = []
  let i = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < items.length) {
        const idx = i++
        results.push(await worker(items[idx], idx))
      }
    })
  )
  return results
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!RPC || !COLLECTION || !IRYS_KEY) {
    console.error('Missing NEXT_PUBLIC_SOLANA_RPC_URL / NEXT_PUBLIC_GEN2_COLLECTION_MINT / IRYS_PRIVATE_KEY')
    process.exit(1)
  }

  // base58 64-byte secret expected for both umi + irys.
  const secret = bs58.decode(IRYS_KEY)
  if (secret.length !== 64) {
    console.error(`IRYS_PRIVATE_KEY must be a 64-byte base58 secret (got ${secret.length} bytes)`)
    process.exit(1)
  }

  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplTokenMetadata())
  const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret))
  umi.use(signerIdentity(signer))
  const signerAddr = String(umi.identity.publicKey)

  const irys = args.execute ? await Uploader(Solana).withWallet(IRYS_KEY).withRpc(RPC) : null

  console.log(`Mode:        ${args.execute ? 'EXECUTE (on-chain writes)' : 'DRY RUN (no writes)'}`)
  console.log(`Signer:      ${signerAddr}`)
  console.log(`Collection:  ${COLLECTION}`)
  console.log(`Site:        ${SITE_URL}`)
  console.log('Listing collection mints via DAS...')

  const listed = await listCollectionMints()
  const candidates = [COLLECTION, ...listed.filter((x) => !x.indexedSafe).map((x) => x.mint)]
  const uniqueCandidates = [...new Set(candidates)].slice(0, args.max === Infinity ? undefined : args.max)
  console.log(`Total in collection: ${listed.length}; indexed-unsafe: ${listed.filter((x) => !x.indexedSafe).length}; processing: ${uniqueCandidates.length} (incl. collection)\n`)

  let fixed = 0, alreadySafe = 0, skipped = 0, failed = 0

  await pool(uniqueCandidates, args.concurrency, async (mint) => {
    try {
      const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(mint) }))
      if (String(md.updateAuthority) !== signerAddr) {
        failed++
        console.log(`SKIP  ${mint}  update_authority_mismatch=${String(md.updateAuthority)}`)
        return
      }
      const currentUri = md.uri?.trim()
      if (!currentUri) { failed++; console.log(`SKIP  ${mint}  missing_uri`); return }

      const json = await fetchJsonFromUri(currentUri)
      if (!json) { failed++; console.log(`FAIL  ${mint}  could_not_fetch_json`); return }

      if (isJsonWalletSafe(json)) { alreadySafe++; console.log(`SAFE  ${mint}  already wallet-safe`); return }

      const fixedJson = buildWalletSafeJson(json)
      if (!fixedJson) { failed++; console.log(`FAIL  ${mint}  no_arweave_image`); return }

      if (!args.execute) {
        skipped++
        console.log(`DRY   ${mint}  name=${(md.name || '').replace(/\0/g, '')}  image→ proxy(${arweaveTxId(imageUrlFromJson(json))})`)
        return
      }

      const receipt = await irys.upload(Buffer.from(JSON.stringify(fixedJson, null, 2), 'utf8'), {
        tags: [{ name: 'Content-Type', value: 'application/json' }],
      })
      const newUri = `https://gateway.irys.xyz/${String(receipt.id)}`

      let lastErr
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await updateV1(umi, {
            mint: publicKey(mint),
            authority: umi.identity,
            data: some({
              name: (md.name || '').replace(/\0/g, '') || md.name,
              symbol: (md.symbol || '').replace(/\0/g, ''),
              uri: newUri,
              sellerFeeBasisPoints: md.sellerFeeBasisPoints,
              creators: md.creators,
            }),
          }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
          const sig = res.signature
          const sigStr = typeof sig === 'string' ? sig : bs58.encode(sig)
          fixed++
          console.log(`FIX   ${mint}  ${sigStr}`)
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          await sleep(1500)
        }
      }
      if (lastErr) { failed++; console.log(`FAIL  ${mint}  ${String(lastErr?.message || lastErr)}`) }
    } catch (e) {
      failed++
      console.log(`FAIL  ${mint}  ${String(e?.message || e)}`)
    }
  })

  console.log(`\nDone. fixed=${fixed} already_safe=${alreadySafe} dry_skipped=${skipped} failed=${failed}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
