/**
 * Scan Gen2 collection for NFTs whose image is not actually fetchable (the ME
 * "Image on chain not available" class), without rewriting healthy mints.
 *
 * Heuristic: DAS image URL → GET (with redirects) → must return image bytes.
 * Also flags missing image / metadata URI.
 *
 * Usage:
 *   node --env-file=.env.local scripts/scan-gen2-broken-images.mjs
 *   node --env-file=.env.local scripts/scan-gen2-broken-images.mjs --concurrency=6 --out=scripts/_gen2-broken-images.json
 */
import fs from 'node:fs'

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
const COLLECTION = process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT?.trim()

function parseArgs(argv) {
  const o = { concurrency: 6, out: 'scripts/_gen2-broken-images.json', max: Infinity, timeoutMs: 18000 }
  for (const a of argv) {
    if (a.startsWith('--concurrency=')) o.concurrency = Math.max(1, Math.min(12, parseInt(a.slice(14), 10) || 6))
    else if (a.startsWith('--out=')) o.out = a.slice(6)
    else if (a.startsWith('--max=')) o.max = Math.max(1, parseInt(a.slice(6), 10) || 0)
    else if (a.startsWith('--timeout=')) o.timeoutMs = Math.max(3000, parseInt(a.slice(10), 10) || 18000)
  }
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rpcCall(method, params, attempt = 0) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'scan', method, params }),
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

function sniffImage(buf) {
  if (!buf || buf.length < 4) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp'
  return null
}

function candidateImageUrls(image) {
  if (!image || typeof image !== 'string') return []
  const raw = image.trim()
  const out = [raw]
  try {
    const u = new URL(raw)
    // Owltopia proxy — also probe the embedded gateway URL (what ME may struggle with).
    if (u.pathname.includes('/api/proxy-image')) {
      const embedded = u.searchParams.get('url')
      if (embedded) out.push(embedded)
    }
    // arweave.net often 302s to a subdomain; also try Irys gateway mirror.
    if (u.hostname === 'arweave.net' || u.hostname.endsWith('.arweave.net')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0]
      if (id) {
        out.push(`https://gateway.irys.xyz/${id}`)
        out.push(`https://gateway.irys.xyz/${id}?ext=png`)
      }
    }
  } catch {
    /* ignore */
  }
  return [...new Set(out)]
}

async function probeUrl(url, timeoutMs) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'image/*,application/octet-stream,*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    const buf = Buffer.from(await res.arrayBuffer())
    const sniffed = sniffImage(buf)
    const looksHtml = ct.includes('text/html') || buf.slice(0, 32).toString('utf8').trimStart().startsWith('<!')
    const ok =
      res.ok &&
      !looksHtml &&
      (sniffed != null || ct.startsWith('image/') || ct.includes('octet-stream')) &&
      buf.length > 100
    return {
      url,
      ok,
      status: res.status,
      contentType: ct || null,
      bytes: buf.length,
      sniffed,
      reason: ok
        ? null
        : looksHtml
          ? 'html_not_image'
          : !res.ok
            ? `http_${res.status}`
            : sniffed == null && !ct.startsWith('image/')
              ? 'not_image'
              : buf.length <= 100
                ? 'too_small'
                : 'unknown',
    }
  } catch (e) {
    return { url, ok: false, status: null, contentType: null, bytes: 0, sniffed: null, reason: String(e.cause?.code || e.cause?.message || e.message || e) }
  }
}

/**
 * Broken if NONE of the candidate image URLs return real image bytes.
 * (If Irys gateway works but arweave.net HTML-fails, ME/Solflare may still break —
 * we flag when the *primary* DAS image fails even if a mirror works, via `primaryFailed`.)
 */
async function classifyAsset(asset, timeoutMs) {
  const mint = asset.id
  const name = asset.content?.metadata?.name || ''
  const image = asset.content?.links?.image ?? asset.content?.files?.[0]?.uri ?? null
  const jsonUri = asset.content?.json_uri ?? null

  if (!image) {
    return { mint, name, image: null, jsonUri, broken: true, reason: 'missing_image', primary: null, mirrors: [] }
  }

  const urls = candidateImageUrls(image)
  const primary = await probeUrl(urls[0], timeoutMs)
  const mirrors = []
  let anyOk = primary.ok
  for (const url of urls.slice(1)) {
    const p = await probeUrl(url, timeoutMs)
    mirrors.push(p)
    if (p.ok) anyOk = true
  }

  // Marketplaces typically use the primary `image` field. If that fails, flag as broken
  // even when a mirror works — that matches ME "Image on chain not available".
  const broken = !primary.ok
  return {
    mint,
    name,
    image,
    jsonUri,
    broken,
    reason: broken ? primary.reason || 'primary_image_failed' : null,
    primary,
    mirrors: mirrors.filter((m) => m.ok).map((m) => m.url),
    anyMirrorOk: anyOk,
  }
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
    out.push(...items)
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
        results[idx] = await worker(items[idx], idx)
        if ((idx + 1) % 50 === 0 || idx + 1 === items.length) {
          process.stdout.write(`\rProbed ${idx + 1}/${items.length}`)
        }
      }
    })
  )
  process.stdout.write('\n')
  return results
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!RPC || !COLLECTION) {
    console.error('Need NEXT_PUBLIC_SOLANA_RPC_URL + NEXT_PUBLIC_GEN2_COLLECTION_MINT')
    process.exit(1)
  }

  console.log(`Collection: ${COLLECTION}`)
  console.log('Listing via DAS...')
  let assets = await listCollection()
  if (args.max < assets.length) assets = assets.slice(0, args.max)
  console.log(`Probing ${assets.length} assets (concurrency=${args.concurrency})...`)

  const results = await pool(assets, args.concurrency, (a) => classifyAsset(a, args.timeoutMs))
  const broken = results.filter((r) => r.broken)
  const ok = results.length - broken.length

  const report = {
    scanned_at: new Date().toISOString(),
    collection: COLLECTION,
    total: results.length,
    ok,
    broken: broken.length,
    items: broken.map((b) => ({
      mint: b.mint,
      name: b.name,
      reason: b.reason,
      image: b.image,
      json_uri: b.jsonUri,
      working_mirrors: b.mirrors,
    })),
  }

  fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
  console.log(`\nOK: ${ok}  BROKEN: ${broken.length}`)
  console.log(`Wrote ${args.out}`)
  for (const b of broken.slice(0, 30)) {
    console.log(`  ${b.mint}  name=${JSON.stringify(b.name)}  reason=${b.reason}`)
  }
  if (broken.length > 30) console.log(`  ... +${broken.length - 30} more`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
