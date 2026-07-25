/**
 * Surgical restore: put Water back on Viking's mint (#1171) and restore
 * pre-repair traits on #1172 (bdizzle), matching original off-by-one mapping:
 *   on-chain name N  →  pack file / JSON #(N+1)
 *
 *   node --env-file=.env.local scripts/restore-gen2-water-1of1.mjs --assets="..."
 *   node --env-file=.env.local scripts/restore-gen2-water-1of1.mjs --assets="..." --execute
 */
import fs from 'node:fs'
import path from 'node:path'
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

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const IRYS_KEY = process.env.IRYS_PRIVATE_KEY?.trim()

const PLAN = [
  {
    label: 'Viking → Water',
    mint: 'Gag1tmnt1Up7LLLgysrZcto9YKrvTxfv8SsDyQJFeuX3',
    onchainName: 'Owltopia G2 #1171',
    packFile: 1172, // Water
  },
  {
    label: 'bdizzle → restore #1173 traits',
    mint: 'GE8mT485VmFkq443YH1PFg8hexn7eC4L1M4cqcsn1wQA',
    onchainName: 'Owltopia G2 #1172',
    packFile: 1173, // regular (pre-repair)
  },
]

function parseArgs(argv) {
  const o = { execute: false, assets: null }
  for (const a of argv) {
    if (a === '--execute') o.execute = true
    else if (a.startsWith('--assets=')) o.assets = a.slice(9).replace(/^"|"$/g, '')
  }
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  return { png: fs.existsSync(png) ? png : null, json }
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

  console.log(`Mode: ${args.execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Assets: ${args.assets}`)

  for (const step of PLAN) {
    const files = resolveAssetPaths(args.assets, step.packFile)
    if (!files.png || !files.json) {
      console.error(`Missing files for pack ${step.packFile}`, files)
      process.exit(1)
    }
    const j = JSON.parse(fs.readFileSync(files.json, 'utf8'))
    const one = (j.attributes || []).find((a) => a.trait_type === '1/1')
    console.log(
      `PLAN  ${step.label}\n       mint=${step.mint}\n       on-chain name keep="${step.onchainName}"\n       pack=${step.packFile} jsonName="${j.name}" trait=${one ? one.value : 'regular'} png=${fs.statSync(files.png).size}B`
    )
  }

  if (!args.execute) {
    console.log('\nDry run only. Re-run with --execute to apply.')
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

  const irys = await Uploader(Solana).withWallet(IRYS_KEY).withRpc(RPC)
  try {
    const estBytes = 2 * 1_500_000
    const price = await irys.getPrice(estBytes)
    const bal = await irys.getLoadedBalance()
    console.log(`Irys balance=${bal} price~${price}`)
    if (bal < price) {
      const topUp = price - bal
      console.log(`Funding Irys ~${topUp}...`)
      await irys.fund(topUp, 1.3)
    }
  } catch (e) {
    console.warn('Irys fund best-effort:', String(e.message || e))
  }

  const results = []
  for (const step of PLAN) {
    const files = resolveAssetPaths(args.assets, step.packFile)
    const localJson = JSON.parse(fs.readFileSync(files.json, 'utf8'))
    const md = await fetchMetadata(umi, findMetadataPda(umi, { mint: publicKey(step.mint) }))
    if (String(md.updateAuthority) !== signerAddr) {
      results.push({ ...step, status: 'authority_mismatch' })
      console.log(`FAIL  ${step.label} authority_mismatch`)
      continue
    }

    const pngBuf = fs.readFileSync(files.png)
    const pngReceipt = await irys.upload(pngBuf, {
      tags: [
        { name: 'Content-Type', value: 'image/png' },
        { name: 'App-Name', value: 'Owltopia-Gen2-Water-Restore' },
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
    if (lastErr) {
      results.push({ ...step, status: 'error', error: String(lastErr.message || lastErr) })
      console.log(`FAIL  ${step.label} ${String(lastErr.message || lastErr)}`)
      continue
    }

    const row = {
      label: step.label,
      mint: step.mint,
      status: 'restored',
      onchainName: newName,
      packFile: step.packFile,
      jsonName: localJson.name,
      oneOne: (localJson.attributes || []).find((a) => a.trait_type === '1/1')?.value || null,
      imageId: String(pngReceipt.id),
      newUri,
      signature: sigStr,
    }
    results.push(row)
    console.log(`OK    ${step.label}  uri=${newUri}  sig=${sigStr}`)
    await sleep(900)
  }

  const outPath = path.join('scripts', '_restore-water-1of1-results.json')
  fs.writeFileSync(outPath, JSON.stringify({ restored_at: new Date().toISOString(), results }, null, 2))
  console.log('\nWrote', outPath)
  console.log(
    'Done.',
    results.map((r) => `${r.label}: ${r.status}`).join(' | ')
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
