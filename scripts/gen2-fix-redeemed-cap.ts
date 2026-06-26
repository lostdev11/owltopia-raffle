/**
 * HOTFIX: the on-chain `redeemedAmount` guard counts CANDY-MACHINE-WIDE itemsRedeemed, NOT a
 * per-group pool. Because the phases run concurrently, mints in any group push the CM total past
 * EVERY other group's per-phase cap, so once the global total crosses a group's cap, every mint in
 * that group fails on-chain with `MaximumRedeemedAmount` (bot-taxed, no NFT — the "tx confirmed but
 * I don't see the NFT" reports). gen1 (343) and pub (200) already broke; pre (657) and wl (800) are
 * latent time bombs that break the instant itemsRedeemed crosses them.
 *
 * This script reads the LIVE candy guard from chain and re-submits the SAME groups byte-for-byte,
 * changing ONLY every group's `redeemedAmount.maximum` -> 2000 (full supply = itemsLoaded, the only
 * real global cap). Per-phase allocation is STILL enforced by allowList + thirdPartySigner (cosigner)
 * + mintLimit + the supply/pool-capped server confirm RPC, so this cannot inflate any phase.
 *
 * Safe by default (dry-run). Pass --confirm to send.
 *   npx --yes tsx --env-file=.env.local scripts/gen2-fix-redeemed-cap.ts
 *   npx --yes tsx --env-file=.env.local scripts/gen2-fix-redeemed-cap.ts --confirm
 */
import bs58 from 'bs58'
import { createSignerFromKeypair, isSome, publicKey, signerIdentity, some, sol, type Umi } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine, safeFetchCandyGuard, updateCandyGuard } from '@metaplex-foundation/mpl-candy-machine'

const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const BOT_TAX_SOL = 0.001
const NEW_MAX = 2000n
// Every phase shares the CM-wide itemsRedeemed counter, so per-group caps below full supply all
// eventually bot-tax legit minters. Bump them ALL to full supply; phase pools stay enforced
// server-side (confirm RPC) + on-chain (allowList/cosigner/mintLimit).
const GROUPS_TO_BUMP = new Set(['gen1', 'pre', 'wl', 'pub'])

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

/** Rebuild a group's guards input from the LIVE fetched guard set, bumping redeemedAmount if asked. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rebuildGuards(g: any, bump: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (isSome(g.startDate)) out.startDate = some({ date: g.startDate.value.date })
  if (isSome(g.endDate)) out.endDate = some({ date: g.endDate.value.date })
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
    out.redeemedAmount = some({ maximum: bump ? NEW_MAX : g.redeemedAmount.value.maximum })
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
  console.log('plan (redeemedAmount.maximum):')
  const groups = guard.groups.map((grp) => {
    const bump = GROUPS_TO_BUMP.has(grp.label)
    const before = isSome(grp.guards.redeemedAmount) ? String(grp.guards.redeemedAmount.value.maximum) : 'none'
    const after = bump && isSome(grp.guards.redeemedAmount) ? String(NEW_MAX) : before
    console.log(`  [${grp.label}] ${before}${bump && before !== after ? ` -> ${after}` : ' (unchanged)'}`)
    return { label: grp.label, guards: rebuildGuards(grp.guards, bump) }
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
    console.error('fix failed:', e)
    process.exit(1)
  })
