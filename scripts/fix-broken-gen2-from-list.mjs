/**
 * Fix only Gen2 mints listed in scripts/_gen2-broken-images.json.
 * For each mint, prefers a working PNG from collections/owltopia-gen2/cache.json
 * at index (tokenNumber - 1), falls back to a still-fetchable on-chain JSON image.
 * Then uploads wallet-safe metadata + updateV1.
 *
 *   node --env-file=.env.local scripts/fix-broken-gen2-from-list.mjs
 *   node --env-file=.env.local scripts/fix-broken-gen2-from-list.mjs --execute
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchMetadata, findMetadataPda, mplTokenMetadata, updateV1 } from '@metaplex-foundation/mpl-token-metadata'
import { createSignerFromKeypair, publicKey, signerIdentity, some } from '@metaplex-foundation/umi'
import { Uploader } from '@irys/upload'
import { Solana } from '@irys/upload-solana'

const require = createRequire(import.meta.url)
const brokenReport = require('./_gen2-broken-images.json')
const cacheItems = require('../collections/owltopia-gen2/cache.json').items

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const IRYS_KEY = process.env.IRYS_PRIVATE_KEY?.trim()
const PROXY_MARKER = '/api/proxy-image'

const execute = process.argv.includes('--execute')
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

async function fetchJson(uri) {
  const id = arweaveTxId(uri)
  const candidates = [...new Set([uri, id ? `https://arweave.net/${id}` : null, id ? `https://gateway.irys.xyz/${id}` : null].filter(Boolean))]
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
      if (!res.ok) continue
      const text = await res.text()
      if (text.trimStart().startsWith('<!')) continue
      return JSON.parse(text)
    } catch {
      /* next */
    }
  }
  return null
}

async function isPng(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'image/*' }, signal: AbortSignal.timeout(15000), redirect: 'follow' })
    const buf = Buffer.from(await res.arrayBuffer())
    return res.ok && buf[0] === 0x89 && buf[1] === 0x50 ? url : null
  } catch {
    return null
  }
}

function buildWalletSafeJson(json, imageUrl) {
  const id = arweaveTxId(imageUrl)
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

async function resolveWorkingImageAndJson(item, onchainUri) {
  const n = tokenNum(item.name)
  const attempts = []

  if (n != null) {
    const cidx = String(n - 1)
    const cached = cacheItems[cidx]
    if (cached?.image_link) attempts.push({ image: cached.image_link, meta: cached.metadata_link, source: `cache:${cidx}` })
    // also try exact index in case naming is 0-based on-chain
    if (cacheItems[String(n)]?.image_link) {
      attempts.push({
        image: cacheItems[String(n)].image_link,
        meta: cacheItems[String(n)].metadata_link,
        source: `cache:${n}`,
      })
    }
  }

  if (item.image) attempts.push({ image: item.image, meta: item.json_uri || onchainUri, source: 'das_image' })
  if (item.json_uri) attempts.push({ image: null, meta: item.json_uri, source: 'das_json' })
  if (onchainUri) attempts.push({ image: null, meta: onchainUri, source: 'onchain_uri' })

  for (const a of attempts) {
    let json = a.meta ? await fetchJson(a.meta) : null
    let image = a.image
    if (!image && json?.image) image = json.image
    if (!image) continue
    const okImage = await isPng(image)
    if (!okImage) continue
    if (!json) {
      json = {
        name: item.name,
        symbol: 'OWL2',
        description: 'Owltopia G2',
        image: okImage,
        attributes: [],
      }
    }
    return { json, image: okImage, source: a.source }
  }
  return null
}

async function main() {
  if (!RPC || !IRYS_KEY) {
    console.error('Missing RPC / IRYS_PRIVATE_KEY')
    process.exit(1)
  }

  const secret = IRYS_KEY.startsWith('[') ? Uint8Array.from(JSON.parse(IRYS_KEY).slice(0, 64)) : bs58.decode(IRYS_KEY)
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplTokenMetadata())
  const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret))
  umi.use(signerIdentity(signer))
  const signerAddr = String(umi.identity.publicKey)
  const irys = execute ? await Uploader(Solana).withWallet(IRYS_KEY).withRpc(RPC) : null

  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}  items=${brokenReport.items.length}  signer=${signerAddr}`)

  const summary = { fixed: 0, already_safe: 0, skipped_no_art: 0, failed: 0, results: [] }

  for (const item of brokenReport.items) {
    const mint = item.mint
    try {
      const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(mint) }))
      if (String(md.updateAuthority) !== signerAddr) {
        summary.failed++
        summary.results.push({ mint, name: item.name, status: 'authority_mismatch' })
        console.log(`SKIP  ${mint}  authority_mismatch`)
        continue
      }
      const onchainUri = (md.uri || '').replace(/\0/g, '').trim()
      const name = (md.name || '').replace(/\0/g, '') || item.name

      const resolved = await resolveWorkingImageAndJson(item, onchainUri)
      if (!resolved) {
        summary.skipped_no_art++
        summary.results.push({ mint, name, status: 'no_recoverable_art' })
        console.log(`NOART ${mint}  name=${name}`)
        await sleep(200)
        continue
      }

      const fixedJson = buildWalletSafeJson(resolved.json, resolved.image)
      if (!fixedJson) {
        summary.failed++
        summary.results.push({ mint, name, status: 'build_failed' })
        console.log(`FAIL  ${mint}  build_failed`)
        continue
      }

      // Already points at proxy + same image id?
      const currentJson = onchainUri ? await fetchJson(onchainUri) : null
      if (
        currentJson &&
        typeof currentJson.image === 'string' &&
        currentJson.image.includes(PROXY_MARKER) &&
        currentJson.image.includes(arweaveTxId(resolved.image) || '___')
      ) {
        summary.already_safe++
        summary.results.push({ mint, name, status: 'already_safe', source: resolved.source })
        console.log(`SAFE  ${mint}  name=${name}`)
        continue
      }

      if (!execute) {
        summary.fixed++
        summary.results.push({ mint, name, status: 'dry', source: resolved.source, image: resolved.image })
        console.log(`DRY   ${mint}  name=${name}  via=${resolved.source}`)
        continue
      }

      const receipt = await irys.upload(Buffer.from(JSON.stringify(fixedJson, null, 2), 'utf8'), {
        tags: [{ name: 'Content-Type', value: 'application/json' }],
      })
      const newUri = `https://gateway.irys.xyz/${String(receipt.id)}`

      let lastErr = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await updateV1(umi, {
            mint: publicKey(mint),
            authority: umi.identity,
            data: some({
              name,
              symbol: (md.symbol || '').replace(/\0/g, '') || 'OWL2',
              uri: newUri,
              sellerFeeBasisPoints: md.sellerFeeBasisPoints,
              creators: md.creators,
            }),
          }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
          const sig = typeof res.signature === 'string' ? res.signature : bs58.encode(res.signature)
          summary.fixed++
          summary.results.push({ mint, name, status: 'fixed', source: resolved.source, signature: sig, newUri })
          console.log(`FIX   ${mint}  name=${name}  via=${resolved.source}  ${sig}`)
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          await sleep(2000 * (attempt + 1))
        }
      }
      if (lastErr) {
        summary.failed++
        summary.results.push({ mint, name, status: 'update_failed', error: String(lastErr.message || lastErr) })
        console.log(`FAIL  ${mint}  ${String(lastErr.message || lastErr)}`)
      }
      await sleep(800)
    } catch (e) {
      summary.failed++
      summary.results.push({ mint, name: item.name, status: 'error', error: String(e.message || e) })
      console.log(`FAIL  ${mint}  ${String(e.message || e)}`)
      await sleep(1500)
    }
  }

  fs.writeFileSync('scripts/_gen2-broken-fix-results.json', JSON.stringify(summary, null, 2))
  console.log('\nDone.', {
    fixed: summary.fixed,
    already_safe: summary.already_safe,
    skipped_no_art: summary.skipped_no_art,
    failed: summary.failed,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
