/**
 * Gen2 Candy Machine pre-mint setup (mainnet) — royalty + guard groups, via UMI.
 *
 * Why UMI and not Sugar: we control the exact merkle-root bytes (base58 from the same
 * lists the site uses) and the freezeSolPayment guards, and reuse the guard-authority key
 * the reprice cron already uses. Do NOT run `sugar guard update` afterwards — it would wipe
 * these groups (config.json keeps only botTax).
 *
 * Subcommands:
 *   royalty   updateCandyMachine -> sellerFeeBasisPoints 1000 (10%) + creators = ROYALTY_RECIPIENT
 *   guards    updateCandyGuard   -> default(botTax) + groups gen1/pre/wl/pub
 *
 * Safe by default (prints the plan). Pass --confirm to send the transaction.
 *   npx --yes tsx --env-file=.env.local scripts/gen2-cm-setup.ts royalty
 *   npx --yes tsx --env-file=.env.local scripts/gen2-cm-setup.ts royalty --confirm
 *   npx --yes tsx --env-file=.env.local scripts/gen2-cm-setup.ts guards
 *   npx --yes tsx --env-file=.env.local scripts/gen2-cm-setup.ts guards --confirm
 *
 * Prereq: lists frozen; Gen1 snapshot taken (else the gen1 group is skipped and AIRDROP
 * cannot mint until you re-run guards after the snapshot).
 */
import bs58 from 'bs58'
import {
  createSignerFromKeypair,
  dateTime,
  percentAmount,
  publicKey,
  signerIdentity,
  sol,
  some,
  type Umi,
} from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  fetchCandyMachine,
  getMerkleRoot,
  mplCandyMachine,
  safeFetchCandyGuard,
  updateCandyGuard,
  updateCandyMachine,
} from '@metaplex-foundation/mpl-candy-machine'

import { listGen1MerkleWallets } from '@/lib/db/gen2-gen1-snapshot'
import { listWlMerkleWallets } from '@/lib/db/owl-center-wl-allocations'
import { listGen2PresaleMerkleWallets } from '@/lib/gen2-presale/db'
import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'
import { getGen2MintProceedsWalletAddress } from '@/lib/owl-center/gen2-mint-proceeds'
import { getGen2CosignerPublicKey } from '@/lib/solana/gen2-cosigner'

// ── Launch constants (mirror owl_center_launches row 2e496154-…) ──────────────
const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const ROYALTY_RECIPIENT = '9fEmycpwGSShBiJ6Pi2xS1qguK6HYdMa9tYCoNiQbT8w' // launch royalty_splits (100%)
const ROYALTY_PERCENT = 10

// All enforced mint payments + the freeze escrow land in ONE server-controlled DISTRIBUTION wallet
// (the candy-guard `solPayment` can only pay one destination). The /api/cron/gen2-treasury-split
// cron then sweeps it 50/50 to the founder wallets (mint_fund_splits). This keeps the on-chain mint
// bot-proof while still funding both founders automatically.
function resolveDistributionWallet(): string {
  const dest = getGen2MintProceedsWalletAddress()
  if (!dest) {
    throw new Error(
      'GEN2_MINT_PROCEEDS_SECRET_KEY (or GEN2_MINT_PROCEEDS_WALLET) not set — generate the distribution wallet first: npx --yes tsx scripts/gen2-gen-distribution-wallet.ts'
    )
  }
  return dest
}

const PHASE_START_ISO = {
  gen1: '2026-06-26T16:00:00Z',
  pre: '2026-06-26T16:00:00Z', // PRESALE start was missing in DB — defaults to AIRDROP kickoff; change if needed
  wl: '2026-06-26T17:00:00Z',
  pub: '2026-06-26T18:00:00Z',
} as const

// Gen1 holder phase stays open 7 days (per Gembird). The 343 gen1 items are RESERVED, but that is
// enforced OFF-CHAIN (gen2PublicPoolCap reserves the gen1 remainder; see gen2-eligibility.ts) — NOT
// by redeemedAmount, which is a global guard (see TOTAL_SUPPLY note). Whatever Gen1 holders don't
// mint in 7 days, the team mints afterwards via `guards --gen1-team` (see below).
const PHASE_END_ISO = {
  gen1: '2026-07-03T16:00:00Z', // gen1 start + 7 days (holder window)
  pre: '2026-07-03T16:00:00Z', // presale start + 7 days (matches gen1 holder window)
  gen1Team: '2026-08-03T16:00:00Z', // extended window for the team to mint the gen1 remainder
} as const

// `guards --gen1-team`: after the 7-day holder window, set the gen1 group to the (updated) snapshot
// — add team wallets to the snapshot via Gen1 CSV first — with no per-wallet mintLimit and a longer
// endDate, so the team can mint the unminted gen1 remainder up to the 343 cap.
const GEN1_TEAM_MODE = process.argv.includes('--gen1-team')

// `guards --with-test-group`: appends a temporary `test` group gated by addressGate to ONE wallet
// (GEN2_TEST_MINT_WALLET, default = the guard authority key) with NO startDate, free + 0-deposit
// freeze, tiny cap. Lets the team mint immediately to validate the 0-lamport freeze end-to-end. Run
// plain `guards --confirm` afterwards to drop it (only gen1/pre/wl/pub are written).
const TEST_GROUP_MODE = process.argv.includes('--with-test-group')
const TEST_GROUP_CAP = 5

const PHASE_SUPPLY = { gen1: 343, pre: 657, wl: 800, pub: 200 } as const
// pub=200 is the legacy nominal slice; PUBLIC is unlimited off-chain (total minus GEN1 + presale
// backstop — see gen2PublicPoolCap). On-chain redeemedAmount uses TOTAL_SUPPLY for every group.
// IMPORTANT: `redeemedAmount` is a GLOBAL candy-guard guard — it compares the candy machine's TOTAL
// itemsRedeemed against `maximum`, NOT a per-group/per-phase counter. So every group's redeemedAmount
// MUST be the full supply, otherwise that phase bot-taxes once the COLLECTION's total mints pass its
// per-phase number (e.g. pub=200 bot-taxed all public mints once the CM passed 200 total). Per-phase
// supply caps are enforced OFF-CHAIN (gen2PublicPoolCap + presale/WL pools in gen2-eligibility.ts),
// per-wallet caps by `mintLimit`, and the hard total cap by the CM's itemsAvailable.
const TOTAL_SUPPLY = Object.values(PHASE_SUPPLY).reduce((a, b) => a + b, 0) // 2000
const PHASE_PRICE_USD = { wl: 30, pub: 40 } as const
const GEN1_MINT_LIMIT = 25 // flat cap >= largest Gen1 holding (23 at snapshot); exact per-NFT count enforced server-side
// Gen2 public is unlimited per wallet off-chain; on-chain backstop = full CM supply.
const PUB_MINT_LIMIT = TOTAL_SUPPLY
const WL_MINT_LIMIT = 2 // every WL wallet's owl_center_wl_allocations.allowed_mints is 2; hard-cap on-chain too
// Flat backstop >= largest pre-group entitlement (max purchased+gifted is 20). Its real purpose is
// to create the on-chain mint-counter PDA the cosign endpoint reads to enforce the EXACT per-wallet
// presale credits (which vary, so the flat cap alone can't); see /api/owl-center/gen2/cosign-mint.
const PRE_MINT_LIMIT = 25
const BOT_TAX_SOL = 0.001

// Split-payment freeze model: the price is charged via solPayment (lands in the distribution wallet
// IMMEDIATELY) and a freezeSolPayment guard triggers the freeze. A 0-lamport deposit was TESTED on
// mainnet (2 test mints) and DOES freeze (token account isFrozen=true, delegate=freeze escrow), so the
// deposit is 0: free mints (gen1/pre) cost only the $1 platform fee + NFT rent + network — the NFT is
// still frozen until the team thaws/unlocks at mint-out.
const FREEZE_DEPOSIT_SOL = 0 // 0 = free mints pay only $1 + rent + network; NFT still freezes (verified)

function getArg(name: string): boolean {
  return process.argv.includes(name)
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

async function setRoyalty(confirm: boolean) {
  const umi = loadAuthorityUmi()
  const cmPk = publicKey(CM_ID)
  const cm = await fetchCandyMachine(umi, cmPk)

  if (Number(cm.itemsRedeemed) > 0) {
    throw new Error(`Refusing: ${cm.itemsRedeemed} items already minted — royalty is effectively locked.`)
  }
  if (String(cm.authority) !== String(umi.identity.publicKey)) {
    throw new Error(`Configured key ${umi.identity.publicKey} is not the CM authority ${cm.authority}.`)
  }

  console.log('royalty plan:')
  console.log(`  sellerFeeBasisPoints: ${cm.data.sellerFeeBasisPoints.basisPoints} -> ${ROYALTY_PERCENT * 100}`)
  console.log(`  creators: [${cm.data.creators.map((c) => `${c.address}:${c.percentageShare}%`).join(', ')}]`)
  console.log(`         -> [${ROYALTY_RECIPIENT}:100%]`)

  if (!confirm) {
    console.log('\n(dry-run) re-run with --confirm to send.')
    return
  }

  const res = await updateCandyMachine(umi, {
    candyMachine: cmPk,
    data: {
      ...cm.data,
      sellerFeeBasisPoints: percentAmount(ROYALTY_PERCENT, 2),
      creators: [{ address: publicKey(ROYALTY_RECIPIENT), verified: false, percentageShare: 100 }],
    },
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  console.log('royalty updated:', bs58.encode(res.signature))
}

function freezeGuard(sols: number, destination: string) {
  return some({ lamports: sol(sols), destination: publicKey(destination) })
}

function solGuard(sols: number, destination: string) {
  return some({ lamports: sol(sols), destination: publicKey(destination) })
}

async function setGuards(confirm: boolean) {
  const umi = loadAuthorityUmi()
  const DEST = resolveDistributionWallet()
  const cmPk = publicKey(CM_ID)
  const cm = await fetchCandyMachine(umi, cmPk)
  const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
  if (!guard) throw new Error('No candy guard at CM mintAuthority.')
  if (String(guard.authority) !== String(umi.identity.publicKey)) {
    throw new Error(`Configured key ${umi.identity.publicKey} is not the guard authority ${guard.authority}.`)
  }

  // Free phases (gen1/presale) mint for free, so the on-chain guard can only check allowlist
  // membership — not the per-wallet count (presale amounts vary, gen1 by NFTs held). A
  // thirdPartySigner gate makes those mints require this server co-signer, which only signs after
  // checking remaining credits (see lib/solana/gen2-cosigner.ts + /api/owl-center/gen2/cosign-mint).
  const cosignerPk = getGen2CosignerPublicKey(umi)
  if (!cosignerPk) {
    throw new Error(
      'GEN2_MINT_COSIGNER_SECRET_KEY not set — generate it first: npx --yes tsx scripts/gen2-gen-cosigner-wallet.ts (gen1/pre groups gate free mints on this co-signer).'
    )
  }

  const [gen1Wallets, preWallets, wlWallets, solUsd] = await Promise.all([
    listGen1MerkleWallets(),
    listGen2PresaleMerkleWallets(),
    listWlMerkleWallets(),
    resolveGen2SolUsdPrice(),
  ])

  const wlSol = PHASE_PRICE_USD.wl / solUsd
  const pubSol = PHASE_PRICE_USD.pub / solUsd

  type Group = { label: string; guards: Record<string, unknown> }
  const groups: Group[] = []

  if (gen1Wallets.length > 0) {
    groups.push({
      label: 'gen1',
      guards: {
        startDate: some({ date: dateTime(PHASE_START_ISO.gen1) }),
        // Team-mint mode extends the window and drops the per-wallet mintLimit so the team can
        // mint the remainder; normal mode keeps the 7-day holder window + per-wallet cap.
        endDate: some({ date: dateTime(GEN1_TEAM_MODE ? PHASE_END_ISO.gen1Team : PHASE_END_ISO.gen1) }),
        allowList: some({ merkleRoot: getMerkleRoot(gen1Wallets) }),
        // Normal holder window: flat backstop + per-wallet counter (read by the cosign endpoint to
        // enforce the EXACT Gen1 NFT count) + server co-sign gate. Team-mint mode intentionally
        // drops BOTH (no per-wallet counter, and team wallets have no gen1 entitlement to co-sign
        // against) so the team can mint the remainder up to the 343 cap.
        ...(GEN1_TEAM_MODE
          ? {}
          : {
              mintLimit: some({ id: 1, limit: GEN1_MINT_LIMIT }),
              thirdPartySigner: some({ signerKey: cosignerPk }),
            }),
        redeemedAmount: some({ maximum: BigInt(TOTAL_SUPPLY) }),
        // Free mint (only $1 platform fee + rent + network); frozen via 0-deposit freezeSolPayment.
        freezeSolPayment: freezeGuard(FREEZE_DEPOSIT_SOL, DEST),
      },
    })
  } else {
    console.warn('!! Gen1 snapshot EMPTY — skipping gen1 group. AIRDROP cannot mint until you take the snapshot and re-run.')
  }

  groups.push({
    label: 'pre',
    guards: {
      startDate: some({ date: dateTime(PHASE_START_ISO.pre) }),
      endDate: some({ date: dateTime(PHASE_END_ISO.pre) }),
      allowList: some({ merkleRoot: getMerkleRoot(preWallets) }),
      redeemedAmount: some({ maximum: BigInt(TOTAL_SUPPLY) }),
      // Free redemption (already paid in USDC); only $1 platform fee + rent + network at mint.
      freezeSolPayment: freezeGuard(FREEZE_DEPOSIT_SOL, DEST),
      // Flat backstop + on-chain per-wallet mint counter (PDA) read by the cosign endpoint to
      // enforce each wallet's EXACT presale credits (purchased+gifted vary, so a flat cap can't).
      mintLimit: some({ id: 4, limit: PRE_MINT_LIMIT }),
      // Server co-sign gate: no free pre-group mint can land without the server signature, which is
      // only given after checking remaining credits (the chain can't express per-wallet presale).
      thirdPartySigner: some({ signerKey: cosignerPk }),
    },
  })
  groups.push({
    label: 'wl',
    guards: {
      startDate: some({ date: dateTime(PHASE_START_ISO.wl) }),
      allowList: some({ merkleRoot: getMerkleRoot(wlWallets) }),
      // Per-wallet cap hard-enforced on-chain (matches the 2 allowed_mints every WL wallet has).
      // Unique id (gen1=1, pub=2) so the on-chain counter PDA does not collide.
      mintLimit: some({ id: 3, limit: WL_MINT_LIMIT }),
      redeemedAmount: some({ maximum: BigInt(TOTAL_SUPPLY) }),
      // Enforced price -> distribution wallet NOW (solPayment) + 0-deposit freeze (freezeSolPayment).
      solPayment: solGuard(Number(wlSol.toFixed(6)), DEST),
      freezeSolPayment: freezeGuard(FREEZE_DEPOSIT_SOL, DEST),
    },
  })
  groups.push({
    label: 'pub',
    guards: {
      // PUBLIC is unlimited off-chain (gen2PublicPoolCap reserves GEN1 + presale backstop). On-chain
      // redeemedAmount is TOTAL_SUPPLY so public mints are not bot-taxed early.
      startDate: some({ date: dateTime(PHASE_START_ISO.pub) }),
      mintLimit: some({ id: 2, limit: PUB_MINT_LIMIT }),
      redeemedAmount: some({ maximum: BigInt(TOTAL_SUPPLY) }),
      solPayment: solGuard(Number(pubSol.toFixed(6)), DEST),
      freezeSolPayment: freezeGuard(FREEZE_DEPOSIT_SOL, DEST),
    },
  })

  const testWallet = process.env.GEN2_TEST_MINT_WALLET?.trim() || String(umi.identity.publicKey)
  if (TEST_GROUP_MODE) {
    groups.push({
      label: 'test',
      guards: {
        // Only this one wallet can use the group; no startDate -> mintable immediately. Free + 0 freeze
        // deposit, so it validates the exact 0-lamport freezeSolPayment path the real phases use.
        addressGate: some({ address: publicKey(testWallet) }),
        redeemedAmount: some({ maximum: BigInt(TEST_GROUP_CAP) }),
        freezeSolPayment: freezeGuard(FREEZE_DEPOSIT_SOL, DEST),
      },
    })
  }

  console.log(`guards plan @ $${solUsd.toFixed(2)}/SOL (distribution wallet=${DEST}):`)
  console.log(`  -> cron /api/cron/gen2-treasury-split sweeps this wallet 50/50 to the founder splits`)
  console.log(`  default: botTax ${BOT_TAX_SOL} SOL`)
  console.log(`  co-signer (gen1/pre thirdPartySigner gate): ${cosignerPk}`)
  console.log(
    `  freeze model: price -> solPayment (distribution wallet NOW) + freezeSolPayment ${FREEZE_DEPOSIT_SOL} SOL deposit (freezes NFT; ${FREEZE_DEPOSIT_SOL === 0 ? 'free mints pay only $1 platform fee + rent + network' : 'escrow -> unlock'})`
  )
  console.log(
    GEN1_TEAM_MODE
      ? `  gen1: TEAM-MINT wallets=${gen1Wallets.length} cap=${PHASE_SUPPLY.gen1} pay=free+${FREEZE_DEPOSIT_SOL} dep mintLimit=NONE thirdPartySigner=OFF start=${PHASE_START_ISO.gen1} end=${PHASE_END_ISO.gen1Team}`
      : `  gen1: wallets=${gen1Wallets.length} cap=${PHASE_SUPPLY.gen1} pay=free+${FREEZE_DEPOSIT_SOL} dep mintLimit(id1)=${GEN1_MINT_LIMIT} thirdPartySigner=ON start=${PHASE_START_ISO.gen1} end=${PHASE_END_ISO.gen1} (7d)`
  )
  console.log(`  pre : wallets=${preWallets.length} cap=${PHASE_SUPPLY.pre} pay=free+${FREEZE_DEPOSIT_SOL} dep mintLimit(id4)=${PRE_MINT_LIMIT} thirdPartySigner=ON start=${PHASE_START_ISO.pre} end=${PHASE_END_ISO.pre} (7d)`)
  console.log(`  wl  : wallets=${wlWallets.length} cap=${PHASE_SUPPLY.wl} pay=${wlSol.toFixed(4)} SOL ($${PHASE_PRICE_USD.wl}) now +${FREEZE_DEPOSIT_SOL} dep mintLimit(id3)=${WL_MINT_LIMIT} start=${PHASE_START_ISO.wl}`)
  console.log(`  pub : cap=${PHASE_SUPPLY.pub} pay=${pubSol.toFixed(4)} SOL ($${PHASE_PRICE_USD.pub}) now +${FREEZE_DEPOSIT_SOL} dep mintLimit(id2)=${PUB_MINT_LIMIT} start=${PHASE_START_ISO.pub}`)
  if (TEST_GROUP_MODE) {
    console.log(`  test: TEMP admin-only group addressGate=${testWallet} cap=${TEST_GROUP_CAP} pay=free+${FREEZE_DEPOSIT_SOL} dep no startDate (drop it later with plain \`guards --confirm\`)`)
  }

  if (!confirm) {
    console.log('\n(dry-run) re-run with --confirm to send. Lists must be FROZEN before you confirm.')
    return
  }

  const res = await updateCandyGuard(umi, {
    candyGuard: guard.publicKey,
    guards: { botTax: some({ lamports: sol(BOT_TAX_SOL), lastInstruction: false }) },
    groups: groups.map((g) => ({ label: g.label, guards: g.guards })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  console.log('guards updated:', bs58.encode(res.signature))
  console.log('\nNext: initialize the freeze escrow before mint -> scripts/gen2-freeze.ts init --confirm')
}

async function main() {
  const cmd = process.argv[2]
  const confirm = getArg('--confirm')
  if (cmd === 'royalty') return setRoyalty(confirm)
  if (cmd === 'guards') return setGuards(confirm)
  console.log('usage: gen2-cm-setup.ts <royalty|guards> [--confirm]')
  process.exit(1)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('setup failed:', e)
    process.exit(1)
  })
