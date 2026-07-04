/**
 * Remove the on-chain `endDate` guard from the free redemption groups (`gen1`, `pre`) so eligible
 * Gen1 holders and presale wallets can keep minting while PUBLIC (and other paid phases) stay live.
 *
 * Per-wallet caps remain enforced by allowList + thirdPartySigner (cosigner) + server confirm RPC.
 * wl / pub groups are copied unchanged.
 *
 * Safe by default (dry-run). Pass --confirm to send.
 *   npx --yes tsx --env-file=.env.local scripts/gen2-open-free-phase-guards.ts
 *   npx --yes tsx --env-file=.env.local scripts/gen2-open-free-phase-guards.ts --confirm
 */
import bs58 from 'bs58'
import { createSignerFromKeypair, isSome, publicKey, signerIdentity, some, sol, type Umi } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine, safeFetchCandyGuard, updateCandyGuard } from '@metaplex-foundation/mpl-candy-machine'

const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const BOT_TAX_SOL = 0.001
/** Drop endDate on these groups only — free Gen1 + presale redemption. */
const GROUPS_TO_OPEN = new Set(['gen1', 'pre'])

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

function formatGuardDate(raw: unknown): string {
  if (raw == null) return 'none'
  const ms = Number(raw)
  if (!Number.isFinite(ms)) return String(raw)
  return new Date(ms).toISOString()
}

/** Rebuild a group's guards from the live chain; omit endDate when opening a free phase group. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rebuildGuards(g: any, stripEndDate: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (isSome(g.startDate)) out.startDate = some({ date: g.startDate.value.date })
  if (isSome(g.endDate) && !stripEndDate) out.endDate = some({ date: g.endDate.value.date })
  if (isSome(g.allowList)) out.allowList = some({ merkleRoot: Uint8Array.from(g.allowList.value.merkleRoot) })
  if (isSome(g.mintLimit)) out.mintLimit = some({ id: g.mintLimit.value.id, limit: g.mintLimit.value.limit })
  if (isSome(g.thirdPartySigner)) out.thirdPartySigner = some({ signerKey: g.thirdPartySigner.value.signerKey })
  if (isSome(g.addressGate)) out.addressGate = some({ address: g.addressGate.value.address })
  if (isSome(g.solPayment))
    out.solPayment = some({ lamports: g.solPayment.value.lamports, destination: g.solPayment.value.destination })
  if (isSome(g.freezeSolPayment))
    out.freezeSolPayment = some({
      lamports: g.freezeSolPayment.value.lamports,
      destination: g.freezeSolPayment.value.destination,
    })
  if (isSome(g.tokenPayment))
    out.tokenPayment = some({ amount: g.tokenPayment.value.amount, mint: g.tokenPayment.value.mint })
  if (isSome(g.redeemedAmount)) {
    out.redeemedAmount = some({ maximum: g.redeemedAmount.value.maximum })
  }
  return out
}

async function main() {
  const confirm = process.argv.includes('--confirm')
  const umi = loadAuthorityUmi()
  const cmPk = publicKey(CM_ID)
  const cm = await fetchCandyMachine(umi, cmPk)
  const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
  if (!guard) throw new Error('No candy guard at CM mintAuthority.')
  if (String(guard.authority) !== String(umi.identity.publicKey)) {
    throw new Error(`Configured key ${umi.identity.publicKey} is not the guard authority ${guard.authority}.`)
  }

  console.log(`CM ${CM_ID} itemsRedeemed=${Number(cm.itemsRedeemed)}/${Number(cm.itemsLoaded)} authority=${guard.authority}`)
  console.log(`now=${new Date().toISOString()}`)
  console.log('plan (endDate):')
  const groups = guard.groups.map((grp) => {
    const strip = GROUPS_TO_OPEN.has(grp.label)
    const before = isSome(grp.guards.endDate)
      ? formatGuardDate(grp.guards.endDate.value.date)
      : 'none'
    const after = strip ? 'none (removed)' : before
    console.log(`  [${grp.label}] ${before}${strip && before !== 'none' ? ` -> ${after}` : strip ? ' (already open)' : ' (unchanged)'}`)
    return { label: grp.label, guards: rebuildGuards(grp.guards, strip) }
  })

  if (!confirm) {
    console.log('\n(dry-run) re-run with --confirm to send the on-chain update.')
    return
  }

  const res = await updateCandyGuard(umi, {
    candyGuard: guard.publicKey,
    guards: { botTax: some({ lamports: sol(BOT_TAX_SOL), lastInstruction: false }) },
    groups: groups.map((g) => ({ label: g.label, guards: g.guards })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  console.log('\nguards updated:', bs58.encode(res.signature))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('open guards failed:', e)
    process.exit(1)
  })
