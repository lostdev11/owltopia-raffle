/**
 * Re-upload local PNGs for Gen2 mints that still have dead Arweave art, then
 * write wallet-safe metadata + updateV1.
 *
 * Expects extracted folder:
 *   <assetsDir>/<N>.png
 *   <assetsDir>/New folder/<N>.json
 *
 * Usage:
 *   node --env-file=.env.local scripts/fix-broken-gen2-from-local-assets.mjs --assets="C:/path"
 *   node --env-file=.env.local scripts/fix-broken-gen2-from-local-assets.mjs --assets="C:/path" --execute
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchMetadata, findMetadataPda, mplTokenMetadata, updateV1 } from '@metaplex-foundation/mpl-token-metadata'
import { createSignerFromKeypair, publicKey, signerIdentity, some } from '@metaplex-foundation/umi'
import { Uploader } from '@irys/upload'
import { Solana } from '@irys/upload-solana'

const require = createRequire(import.meta.url)
const fixResults = require('./_gen2-broken-fix-results.json')

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const IRYS_KEY = process.env.IRYS_PRIVATE_KEY?.trim()

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
  return {
    png: fs.existsSync(png) ? png : null,
    json,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!RPC || !IRYS_KEY) {
    console.error('Missing NEXT_PUBLIC_SOLANA_RPC_URL / IRYS_PRIVATE_KEY')
    process.exit(1)
  }
  if (!args.assets || !fs.existsSync(args.assets)) {
    console.error('Pass --assets=<extracted gen2 folder containing N.png>')
    process.exit(1)
  }

  const need = fixResults.results
    .filter((r) => r.status === 'no_recoverable_art')
    .slice(0, args.max === Infinity ? undefined : args.max)

  console.log(`Mode: ${args.execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Assets: ${args.assets}`)
  console.log(`Candidates: ${need.length}`)

  const secret = IRYS_KEY.startsWith('[')
    ? Uint8Array.from(JSON.parse(IRYS_KEY).slice(0, 64))
    : bs58.decode(IRYS_KEY)
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplTokenMetadata())
  const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret))
  umi.use(signerIdentity(signer))
  const signerAddr = String(umi.identity.publicKey)
  console.log(`Signer: ${signerAddr}`)

  const irys = args.execute ? await Uploader(Solana).withWallet(IRYS_KEY).withRpc(RPC) : null

  // Rough fund for ~350KB avg PNG * N + JSON
  if (args.execute && irys) {
    try {
      const estBytes = need.length * 400_000
      const price = await irys.getPrice(estBytes)
      const bal = await irys.getLoadedBalance()
      console.log(`Irys loaded balance=${bal} price~${price} for ~${estBytes} bytes`)
      if (bal < price) {
        const topUp = price - bal
        console.log(`Funding Irys with ~${topUp} atomic units...`)
        await irys.fund(topUp, 1.3)
      }
    } catch (e) {
      console.warn('Irys fund best-effort failed:', String(e.message || e))
    }
  }

  const summary = { fixed: 0, skipped: 0, failed: 0, results: [] }

  for (const item of need) {
    const n = tokenNum(item.name)
    if (n == null) {
      summary.skipped++
      summary.results.push({ mint: item.mint, name: item.name, status: 'no_token_number' })
      console.log(`SKIP  ${item.mint}  no_token_number`)
      continue
    }
    const files = resolveAssetPaths(args.assets, n)
    if (!files.png || !files.json) {
      summary.skipped++
      summary.results.push({
        mint: item.mint,
        name: item.name,
        status: 'missing_local_files',
        png: Boolean(files.png),
        json: Boolean(files.json),
      })
      console.log(`SKIP  ${item.mint}  name=${n} missing png=${!files.png} json=${!files.json}`)
      continue
    }

    try {
      const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(item.mint) }))
      if (String(md.updateAuthority) !== signerAddr) {
        summary.failed++
        summary.results.push({ mint: item.mint, name: item.name, status: 'authority_mismatch' })
        console.log(`FAIL  ${item.mint}  authority_mismatch`)
        continue
      }

      const localJson = JSON.parse(fs.readFileSync(files.json, 'utf8'))
      const onchainName = (md.name || '').replace(/\0/g, '') || String(n)
      // Prefer branded JSON name when present; keep length within Metaplex limits.
      const newName = String(localJson.name || onchainName).slice(0, 32)
      const newSymbol = String(localJson.symbol || (md.symbol || '').replace(/\0/g, '') || 'OWL2').slice(0, 10)

      if (!args.execute) {
        summary.fixed++
        summary.results.push({
          mint: item.mint,
          name: item.name,
          status: 'dry',
          pngBytes: fs.statSync(files.png).size,
          newName,
        })
        console.log(`DRY   ${item.mint}  #${n}  png=${fs.statSync(files.png).size}B  -> "${newName}"`)
        continue
      }

      const pngBuf = fs.readFileSync(files.png)
      const pngReceipt = await irys.upload(pngBuf, {
        tags: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'App-Name', value: 'Owltopia-Gen2-Repair' },
        ],
      })
      const imageGateway = `https://gateway.irys.xyz/${String(pngReceipt.id)}`
      const fixedJson = buildWalletSafeJson(localJson, imageGateway)
      if (!fixedJson) throw new Error('buildWalletSafeJson failed')

      const jsonReceipt = await irys.upload(Buffer.from(JSON.stringify(fixedJson, null, 2), 'utf8'), {
        tags: [{ name: 'Content-Type', value: 'application/json' }],
      })
      const newUri = `https://gateway.irys.xyz/${String(jsonReceipt.id)}`

      let lastErr = null
      let sigStr = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await updateV1(umi, {
            mint: publicKey(item.mint),
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

      summary.fixed++
      summary.results.push({
        mint: item.mint,
        name: item.name,
        status: 'fixed',
        newName,
        imageId: String(pngReceipt.id),
        newUri,
        signature: sigStr,
      })
      console.log(`FIX   ${item.mint}  #${n}  "${newName}"  ${sigStr}`)
      await sleep(900)
    } catch (e) {
      summary.failed++
      summary.results.push({ mint: item.mint, name: item.name, status: 'error', error: String(e.message || e) })
      console.log(`FAIL  ${item.mint}  #${n}  ${String(e.message || e)}`)
      await sleep(2000)
    }
  }

  fs.writeFileSync(
    path.join('scripts', '_gen2-local-assets-fix-results.json'),
    JSON.stringify(summary, null, 2)
  )
  console.log('\nDone.', { fixed: summary.fixed, skipped: summary.skipped, failed: summary.failed })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
