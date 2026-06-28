/**
 * One-off fix: raise the Gen2 candy guard `redeemedAmount` guard on every group to the candy
 * machine's full supply (itemsAvailable), so public (and Gen1 concurrent) mints stop bot-taxing.
 *
 * Why: `redeemedAmount` checks the candy machine's GLOBAL itemsRedeemed, not a per-phase counter.
 * The groups were set with per-phase caps (gen1=343, pre=657, wl=800, pub=200) that sum to 2000,
 * but because the guard is global, each phase started bot-taxing once total redeemed passed its cap
 * (public died at 200; the CM is now at ~1227). Per-phase supply caps are already enforced off-chain
 * (gen2PublicPoolCap / presale + WL pools in gen2-eligibility.ts) and total supply is hard-capped by
 * the candy machine's itemsAvailable, so the on-chain redeemedAmount caps are redundant + broken.
 *
 * Leaves every other guard untouched (incl. solPayment prices and mintLimit). Uses the same guard
 * authority key as the reprice cron (GEN2_GUARD_AUTHORITY_SECRET_KEY, fallback IRYS_PRIVATE_KEY).
 *
 *   Dry run:  npx --yes tsx --env-file=.env.local scripts/gen2-fix-redeemed-amount.ts
 *   Apply:    npx --yes tsx --env-file=.env.local scripts/gen2-fix-redeemed-amount.ts --confirm
 */
import bs58 from 'bs58'
import {
  createSignerFromKeypair,
  isSome,
  publicKey,
  signerIdentity,
  some,
  type Umi,
} from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  fetchCandyMachine,
  mplCandyMachine,
  safeFetchCandyGuard,
  updateCandyGuard,
} from '@metaplex-foundation/mpl-candy-machine'

const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

function parseGuardAuthoritySecret(): Uint8Array | null {
  const raw = process.env.GEN2_GUARD_AUTHORITY_SECRET_KEY?.trim() || process.env.IRYS_PRIVATE_KEY?.trim()
  if (!raw) return null
  try {
    return bs58.decode(raw)
  } catch {
    try {
      const parsed = JSON.parse(raw) as number[]
      if (Array.isArray(parsed) && parsed.length >= 64) return Uint8Array.from(parsed)
    } catch {
      // not JSON
    }
  }
  return null
}

async function main() {
  const confirm = process.argv.includes('--confirm')

  const secret = parseGuardAuthoritySecret()
  if (!secret) throw new Error('Guard authority key not set (GEN2_GUARD_AUTHORITY_SECRET_KEY / IRYS_PRIVATE_KEY)')

  const umi: Umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplCandyMachine())
  const kp = umi.eddsa.createKeypairFromSecretKey(secret)
  umi.use(signerIdentity(createSignerFromKeypair(umi, kp)))

  const cm = await fetchCandyMachine(umi, publicKey(CM_ID))
  const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
  if (!guard) throw new Error('No candy guard at CM mintAuthority')

  if (String(guard.authority) !== String(umi.identity.publicKey)) {
    throw new Error(
      `Configured key ${String(umi.identity.publicKey)} is NOT the guard authority (${String(guard.authority)}).`
    )
  }

  const target = BigInt(cm.data.itemsAvailable) // full supply (2000)
  console.log(`CM ${CM_ID}  guard ${String(guard.publicKey)}`)
  console.log(`itemsAvailable=${cm.data.itemsAvailable}  itemsRedeemed=${cm.itemsRedeemed}`)
  console.log(`target redeemedAmount.maximum = ${target}`)
  console.log('')

  let changes = 0
  const nextGroups = guard.groups.map((g) => {
    const ra = g.guards.redeemedAmount
    if (!isSome(ra)) {
      console.log(`  [${g.label}] redeemedAmount NONE — unchanged`)
      return g
    }
    const current = ra.value.maximum
    if (current === target) {
      console.log(`  [${g.label}] redeemedAmount already ${current} — unchanged`)
      return g
    }
    console.log(`  [${g.label}] redeemedAmount ${current} -> ${target}`)
    changes++
    return { ...g, guards: { ...g.guards, redeemedAmount: some({ maximum: target }) } }
  })

  if (changes === 0) {
    console.log('\nNothing to change.')
    return
  }

  if (!confirm) {
    console.log(`\nDRY RUN — ${changes} group(s) would change. Re-run with --confirm to send.`)
    return
  }

  const res = await updateCandyGuard(umi, {
    candyGuard: guard.publicKey,
    guards: guard.guards,
    groups: nextGroups,
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  console.log(`\nUpdated. signature = ${bs58.encode(res.signature)}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('fix failed:', e)
    process.exit(1)
  })
