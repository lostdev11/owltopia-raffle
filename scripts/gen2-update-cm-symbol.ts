/**
 * Update the Candy Machine's on-chain data.symbol so FUTURE mints carry the new
 * symbol. The per-token JSON metadata already uses the new symbol; this fixes the
 * symbol the candy machine stamps onto each minted NFT at mint time.
 *
 *   npx --yes tsx --env-file=.env.local scripts/gen2-update-cm-symbol.ts          # dry-run
 *   npx --yes tsx --env-file=.env.local scripts/gen2-update-cm-symbol.ts --confirm
 */
import bs58 from 'bs58'
import { createSignerFromKeypair, publicKey, signerIdentity, type Umi } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine, updateCandyMachine } from '@metaplex-foundation/mpl-candy-machine'

const CM_ID = process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID || 'BYBehCvckib5edwST3K3Z13YB9Gap5sSBXqbBWiiMm6Q'
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const NEW_SYMBOL = 'OWL2'

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
  const umi = loadAuthorityUmi()
  const cmPk = publicKey(CM_ID)
  const cm = await fetchCandyMachine(umi, cmPk)

  if (String(cm.authority) !== String(umi.identity.publicKey)) {
    throw new Error(`Configured key ${umi.identity.publicKey} is not the CM authority ${cm.authority}.`)
  }

  console.log(`CM ${CM_ID}`)
  console.log(`  data.symbol: "${cm.data.symbol}" -> "${NEW_SYMBOL}"`)
  if (cm.data.symbol === NEW_SYMBOL) {
    console.log('Already set — nothing to do.')
    return
  }
  if (!confirm) {
    console.log('\n(dry-run) re-run with --confirm to send.')
    return
  }

  await updateCandyMachine(umi, {
    candyMachine: cmPk,
    data: { ...cm.data, symbol: NEW_SYMBOL },
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
  console.log('Done. CM data.symbol updated.')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('update failed:', e)
    process.exit(1)
  })
