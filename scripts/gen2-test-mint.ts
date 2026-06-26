/**
 * Gen2 TEST mint — mints ONE NFT through the temporary admin-only `test` guard group to validate
 * the full Candy Machine path + the 0-lamport freezeSolPayment (NFT must come out FROZEN).
 *
 * Prereq: `gen2-cm-setup.ts guards --with-test-group --confirm` (adds the `test` group gated to this
 * wallet), and the freeze escrow is initialized (gen2-freeze.ts init). Signs with the same key as
 * the guard authority (GEN2_GUARD_AUTHORITY_SECRET_KEY / IRYS_PRIVATE_KEY) = the addressGate wallet.
 *
 * Safe by default (prints plan). Pass --confirm to actually mint (consumes 1 of 2000 items).
 *   npx --yes tsx --env-file=.env.local scripts/gen2-test-mint.ts
 *   npx --yes tsx --env-file=.env.local scripts/gen2-test-mint.ts --confirm
 *
 * After: drop the test group with `gen2-cm-setup.ts guards --confirm` (no flag).
 */
import bs58 from 'bs58'
import {
  createSignerFromKeypair,
  generateSigner,
  publicKey,
  signerIdentity,
  some,
  type Umi,
} from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  fetchCandyMachine,
  mintV2,
  mplCandyMachine,
  safeFetchCandyGuard,
} from '@metaplex-foundation/mpl-candy-machine'
import {
  fetchMetadata,
  findMasterEditionPda,
  findMetadataPda,
} from '@metaplex-foundation/mpl-token-metadata'
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox'
import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token'

import { getGen2MintProceedsWalletAddress } from '@/lib/owl-center/gen2-mint-proceeds'

const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const COLLECTION = process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT || 'GkLgT4KuwAPKeMSzfcPPmzuGimRNPvK1FWNPks4kzFVA'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const TEST_GROUP = 'test'

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

async function main() {
  const confirm = process.argv.includes('--confirm')
  const DEST = getGen2MintProceedsWalletAddress()
  if (!DEST) throw new Error('GEN2_MINT_PROCEEDS_SECRET_KEY / GEN2_MINT_PROCEEDS_WALLET not set (freeze destination)')

  const umi = loadAuthorityUmi()
  const minter = String(umi.identity.publicKey)
  const cmPk = publicKey(CM_ID)
  const cm = await fetchCandyMachine(umi, cmPk)
  const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
  if (!guard) throw new Error('No candy guard at CM mintAuthority.')

  const hasTestGroup = guard.groups.some((g) => g.label === TEST_GROUP)
  if (!hasTestGroup) {
    throw new Error('No `test` group on-chain. Run: gen2-cm-setup.ts guards --with-test-group --confirm')
  }

  const remaining = Number(cm.itemsLoaded) - Number(cm.itemsRedeemed)
  console.log(`test mint plan: minter=${minter} group=${TEST_GROUP} freezeDest=${DEST} remaining=${remaining}`)
  if (!confirm) {
    console.log('(dry-run) re-run with --confirm to mint 1 (consumes 1 of 2000).')
    return
  }

  const collectionMintPk = publicKey(COLLECTION)
  const collectionMetadata = findMetadataPda(umi, { mint: collectionMintPk })
  const collectionMasterEdition = findMasterEditionPda(umi, { mint: collectionMintPk })
  const md = await fetchMetadata(umi, collectionMetadata)
  const collectionUpdateAuthority = publicKey(String(md.updateAuthority))

  const nftMint = generateSigner(umi)
  console.log(`minting NFT ${String(nftMint.publicKey)} …`)

  const res = await setComputeUnitLimit(umi, { units: 800_000 })
    .add(
      mintV2(umi, {
        candyMachine: cmPk,
        candyGuard: guard.publicKey,
        nftMint,
        collectionMint: collectionMintPk,
        collectionUpdateAuthority,
        collectionMetadata,
        collectionMasterEdition,
        group: some(TEST_GROUP),
        mintArgs: {
          freezeSolPayment: some({ destination: publicKey(DEST) }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    )
    .sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

  console.log('mint tx:', bs58.encode(res.signature))

  // Verify the NFT token account is FROZEN (proves the 0-lamport freezeSolPayment worked).
  const connection = new Connection(RPC, 'confirmed')
  const ata = getAssociatedTokenAddressSync(new PublicKey(String(nftMint.publicKey)), new PublicKey(minter))
  try {
    const acct = await getAccount(connection, ata, 'confirmed')
    const frozen = acct.isFrozen
    console.log(`token account ${ata.toBase58()} amount=${acct.amount} ${frozen ? 'FROZEN ✅' : 'NOT frozen ⚠️'} delegate=${acct.delegate?.toBase58() ?? 'none'}`)
    if (!frozen) {
      console.log('⚠️  NFT minted but NOT frozen — investigate before launch.')
    } else {
      console.log('✅ 0-lamport freeze works end-to-end. Drop the test group: gen2-cm-setup.ts guards --confirm')
    }
  } catch (e) {
    console.log('could not read token account state:', e instanceof Error ? e.message : e)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('test mint failed:', e)
    process.exit(1)
  })
