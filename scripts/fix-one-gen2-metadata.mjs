/**
 * Find Gen2 mint by prefix / name and optionally fix wallet-safe metadata for that mint only.
 * Usage:
 *   node --env-file=.env.local scripts/fix-one-gen2-metadata.mjs --find=54QF
 *   node --env-file=.env.local scripts/fix-one-gen2-metadata.mjs --mint=<full> --execute
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
  const o = { execute: false, mint: null, find: null, name: null }
  for (const a of argv) {
    if (a === '--execute') o.execute = true
    else if (a.startsWith('--mint=')) o.mint = a.slice(7).trim()
    else if (a.startsWith('--find=')) o.find = a.slice(7).trim()
    else if (a.startsWith('--name=')) o.name = a.slice(7).trim()
  }
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rpcCall(method, params, attempt = 0) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'one', method, params }),
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
  const candidates = [...new Set([uri, id ? `https://arweave.net/${id}` : null, id ? `https://gateway.irys.xyz/${id}` : null, id ? `https://ar-io.net/${id}` : null].filter(Boolean))]
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
      if (!res.ok) continue
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      const text = await res.text()
      if (ct.includes('text/html') || text.trimStart().startsWith('<!')) continue
      return JSON.parse(text)
    } catch {
      /* next */
    }
  }
  return null
}

async function findMints({ find, name }) {
  const hits = []
  for (let page = 1; page <= 50; page++) {
    const r = await rpcCall('getAssetsByGroup', { groupKey: 'collection', groupValue: COLLECTION, page, limit: 1000 })
    const items = r.items ?? []
    if (items.length === 0) break
    for (const a of items) {
      const mint = a.id
      const n = a.content?.metadata?.name || ''
      const image = a.content?.links?.image ?? a.content?.files?.[0]?.uri
      const matchFind = find ? mint.startsWith(find) || mint.includes(find) : true
      const matchName = name
        ? String(n).replace(/\0/g, '').includes(name) || String(n).replace(/\0/g, '') === name
        : true
      if (matchFind && matchName) {
        hits.push({ mint, name: n, image, json_uri: a.content?.json_uri })
      }
    }
    if (items.length < 1000) break
  }
  return hits
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!RPC || !COLLECTION || !IRYS_KEY) {
    console.error('Missing env')
    process.exit(1)
  }

  let mint = args.mint
  if (!mint) {
    if (!args.find && !args.name) {
      console.error('Pass --mint=... or --find=54QF and/or --name=744')
      process.exit(1)
    }
    console.log('Searching collection via DAS...')
    const hits = await findMints({ find: args.find, name: args.name })
    console.log(JSON.stringify(hits, null, 2))
    if (hits.length !== 1) {
      console.error(`Expected 1 hit, got ${hits.length}`)
      process.exit(hits.length ? 2 : 1)
    }
    mint = hits[0].mint
  }

  const secret = IRYS_KEY.startsWith('[') ? Uint8Array.from(JSON.parse(IRYS_KEY).slice(0, 64)) : bs58.decode(IRYS_KEY)
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplTokenMetadata())
  const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret))
  umi.use(signerIdentity(signer))
  const signerAddr = String(umi.identity.publicKey)

  const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(mint) }))
  const name = (md.name || '').replace(/\0/g, '')
  const uri = (md.uri || '').replace(/\0/g, '').trim()
  console.log(JSON.stringify({ mint, name, uri, updateAuthority: String(md.updateAuthority) }, null, 2))

  if (String(md.updateAuthority) !== signerAddr) {
    console.error('update_authority_mismatch')
    process.exit(1)
  }

  const json = await fetchJsonFromUri(uri)
  if (!json) {
    console.error('could_not_fetch_json')
    process.exit(1)
  }
  if (isJsonWalletSafe(json)) {
    console.log('Already wallet-safe')
    return
  }
  const fixedJson = buildWalletSafeJson(json)
  if (!fixedJson) {
    console.error('no_arweave_image')
    process.exit(1)
  }

  if (!args.execute) {
    console.log('DRY — would update to proxy image', arweaveTxId(imageUrlFromJson(json)))
    return
  }

  const irys = await Uploader(Solana).withWallet(IRYS_KEY).withRpc(RPC)
  const receipt = await irys.upload(Buffer.from(JSON.stringify(fixedJson, null, 2), 'utf8'), {
    tags: [{ name: 'Content-Type', value: 'application/json' }],
  })
  const newUri = `https://gateway.irys.xyz/${String(receipt.id)}`
  const res = await updateV1(umi, {
    mint: publicKey(mint),
    authority: umi.identity,
    data: some({
      name: name || md.name,
      symbol: (md.symbol || '').replace(/\0/g, ''),
      uri: newUri,
      sellerFeeBasisPoints: md.sellerFeeBasisPoints,
      creators: md.creators,
    }),
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  const sig = typeof res.signature === 'string' ? res.signature : bs58.encode(res.signature)
  console.log(JSON.stringify({ ok: true, mint, newUri, signature: sig }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
