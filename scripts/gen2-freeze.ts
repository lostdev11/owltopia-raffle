/**
 * Gen2 freezeSolPayment lifecycle (mainnet). All groups freeze to the same DISTRIBUTION wallet,
 * so the freeze escrow PDA (destination, candyMachine, candyGuard) is SHARED — init/unlock once.
 *
 *   init    Create the freeze escrow. MUST run after `gen2-cm-setup guards` and BEFORE the
 *           first mint, or every freezeSolPayment mint fails.
 *   thaw    After mint-out (or the 30-day period), unfreeze every minted NFT so holders can
 *           trade. Enumerates the collection via Helius DAS and thaws each at its current owner.
 *   unlock  After ALL NFTs are thawed, release the freeze escrow to the distribution wallet (the
 *           freeze DEPOSIT is 0, so this mostly just closes the escrow; the enforced mint price
 *           already landed in the distribution wallet via solPayment and is swept by the cron).
 *
 * Safe by default (prints plan). Pass --confirm to send.
 *   npx --yes tsx --env-file=.env.local scripts/gen2-freeze.ts init   --confirm
 *   npx --yes tsx --env-file=.env.local scripts/gen2-freeze.ts thaw   --confirm
 *   npx --yes tsx --env-file=.env.local scripts/gen2-freeze.ts unlock --confirm
 */
import bs58 from 'bs58'
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
  type Umi,
} from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine, route, safeFetchCandyGuard } from '@metaplex-foundation/mpl-candy-machine'
import { TokenStandard } from '@metaplex-foundation/mpl-token-metadata'

import { getGen2MintProceedsWalletAddress } from '@/lib/owl-center/gen2-mint-proceeds'

const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const COLLECTION = process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT || 'GkLgT4KuwAPKeMSzfcPPmzuGimRNPvK1FWNPks4kzFVA'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const FREEZE_GROUP = 'pub' // any group with the distribution-wallet destination shares the escrow
const FREEZE_PERIOD_SECONDS = 30 * 24 * 60 * 60 // 30 days (Metaplex max). Thaw also unlocks at mint-out.

/** The freeze escrow destination MUST match the guard's freezeSolPayment destination (gen2-cm-setup). */
function resolveDistributionWallet(): string {
  const dest = getGen2MintProceedsWalletAddress()
  if (!dest) {
    throw new Error(
      'GEN2_MINT_PROCEEDS_SECRET_KEY (or GEN2_MINT_PROCEEDS_WALLET) not set — must match the destination used in gen2-cm-setup.ts guards.'
    )
  }
  return dest
}

function confirmFlag() {
  return process.argv.includes('--confirm')
}

function loadAuthorityUmi(): Umi {
  const raw = process.env.GEN2_GUARD_AUTHORITY_SECRET_KEY?.trim() || process.env.IRYS_PRIVATE_KEY?.trim()
  if (!raw) throw new Error('GEN2_GUARD_AUTHORITY_SECRET_KEY (or IRYS_PRIVATE_KEY) not set')
  let secret: Uint8Array
  try {
    secret = bs58.decode(raw)
  } catch {
    secret = Uint8Array.from(JSON.parse(raw) as number[])
  }
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplCandyMachine())
  const kp = umi.eddsa.createKeypairFromSecretKey(secret)
  umi.use(signerIdentity(createSignerFromKeypair(umi, kp)))
  return umi
}

async function loadGuard(umi: Umi) {
  const cm = await fetchCandyMachine(umi, publicKey(CM_ID))
  const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
  if (!guard) throw new Error('No candy guard at CM mintAuthority.')
  if (String(guard.authority) !== String(umi.identity.publicKey)) {
    throw new Error(`Configured key ${umi.identity.publicKey} is not the guard authority ${guard.authority}.`)
  }
  return { cm, guard }
}

async function doInit(confirm: boolean) {
  const umi = loadAuthorityUmi()
  const DEST = resolveDistributionWallet()
  const { guard } = await loadGuard(umi)
  console.log(`init freeze escrow: destination=${DEST} period=${FREEZE_PERIOD_SECONDS}s (~30d) group=${FREEZE_GROUP}`)
  if (!confirm) return console.log('(dry-run) re-run with --confirm to send.')
  try {
    const res = await route(umi, {
      candyMachine: publicKey(CM_ID),
      candyGuard: guard.publicKey,
      guard: 'freezeSolPayment',
      group: FREEZE_GROUP,
      routeArgs: {
        path: 'initialize',
        destination: publicKey(DEST),
        period: FREEZE_PERIOD_SECONDS,
        candyGuardAuthority: umi.identity,
      },
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    console.log('freeze escrow initialized:', bs58.encode(res.signature))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/already in use|already initialized|already exists|FreezeEscrowAlreadyExists|0x1796|0x0\b/i.test(msg)) {
      console.log('freeze escrow already initialized — nothing to do.')
      return
    }
    throw e
  }
}

type DasAsset = { id: string; ownership?: { owner?: string } }

async function fetchCollectionAssets(): Promise<DasAsset[]> {
  const out: DasAsset[] = []
  for (let page = 1; ; page++) {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'gen2-thaw',
        method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: COLLECTION, page, limit: 1000 },
      }),
    })
    const json = (await res.json()) as { result?: { items?: DasAsset[] }; error?: { message?: string } }
    if (json.error) throw new Error(`DAS getAssetsByGroup failed: ${json.error.message}`)
    const items = json.result?.items ?? []
    out.push(...items)
    if (items.length < 1000) break
  }
  return out
}

async function doThaw(confirm: boolean) {
  const umi = loadAuthorityUmi()
  const DEST = resolveDistributionWallet()
  const { guard } = await loadGuard(umi)
  const assets = await fetchCollectionAssets()
  console.log(`thaw: found ${assets.length} minted NFTs in collection ${COLLECTION}`)
  if (!confirm) return console.log('(dry-run) re-run with --confirm to thaw each NFT.')

  let ok = 0
  let skipped = 0
  for (const a of assets) {
    const owner = a.ownership?.owner
    if (!owner) {
      skipped++
      continue
    }
    try {
      const res = await route(umi, {
        candyMachine: publicKey(CM_ID),
        candyGuard: guard.publicKey,
        guard: 'freezeSolPayment',
        group: FREEZE_GROUP,
        routeArgs: {
          path: 'thaw',
          destination: publicKey(DEST),
          nftMint: publicKey(a.id),
          nftOwner: publicKey(owner),
          nftTokenStandard: TokenStandard.NonFungible,
        },
      }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
      ok++
      if (ok % 25 === 0) console.log(`  thawed ${ok}/${assets.length} (last ${bs58.encode(res.signature).slice(0, 8)}…)`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Already thawed / not frozen — safe to skip.
      skipped++
      if (skipped <= 5) console.warn(`  skip ${a.id.slice(0, 8)}…: ${msg.split('\n')[0]}`)
    }
  }
  console.log(`thaw done: ${ok} thawed, ${skipped} skipped. When all are thawed, run: unlock --confirm`)
}

async function doUnlock(confirm: boolean) {
  const umi = loadAuthorityUmi()
  const DEST = resolveDistributionWallet()
  const { guard } = await loadGuard(umi)
  console.log(`unlock funds -> ${DEST} (requires ALL NFTs already thawed)`)
  if (!confirm) return console.log('(dry-run) re-run with --confirm to send.')
  const res = await route(umi, {
    candyMachine: publicKey(CM_ID),
    candyGuard: guard.publicKey,
    guard: 'freezeSolPayment',
    group: FREEZE_GROUP,
    routeArgs: {
      path: 'unlockFunds',
      destination: publicKey(DEST),
      candyGuardAuthority: umi.identity,
    },
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  console.log('funds unlocked:', bs58.encode(res.signature))
}

async function main() {
  const cmd = process.argv[2]
  const confirm = confirmFlag()
  if (cmd === 'init') return doInit(confirm)
  if (cmd === 'thaw') return doThaw(confirm)
  if (cmd === 'unlock') return doUnlock(confirm)
  console.log('usage: gen2-freeze.ts <init|thaw|unlock> [--confirm]')
  process.exit(1)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('freeze op failed:', e)
    process.exit(1)
  })
