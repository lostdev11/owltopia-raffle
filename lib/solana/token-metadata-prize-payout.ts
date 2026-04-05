/**
 * Server-side payout for SPL Token–program NFTs held in prize escrow using Metaplex Token Metadata
 * transferV1 — same path as the wallet deposit flow in token-metadata-transfer.ts.
 * Raw SPL TransferInstruction fails for many programmable / freeze-authority NFTs that still move
 * normally via Token Metadata in Phantom and other wallets.
 */
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { createSignerFromKeypair, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi'
import { mplTokenMetadata, transferV1, TokenStandard } from '@metaplex-foundation/mpl-token-metadata'
import { toWeb3JsLegacyTransaction } from '@metaplex-foundation/umi-web3js-adapters'

export type TokenMetadataEscrowPayoutParams = {
  connection: Connection
  escrowKeypair: Keypair
  mint: PublicKey
  destinationOwner: PublicKey
  skipPreflight?: boolean
}

/**
 * Tries NonFungible then ProgrammableNonFungible Token Metadata transfer from escrow to destination.
 * Returns null if both standards fail (caller may fall back to raw SPL transfer).
 */
export async function trySendSplNftViaTokenMetadataFromEscrow(
  opts: TokenMetadataEscrowPayoutParams
): Promise<{ signature: string } | null> {
  const { connection, escrowKeypair, mint, destinationOwner, skipPreflight = false } = opts

  const umi = createUmi(connection).use(mplTokenMetadata())
  const umiEscrowSigner = createSignerFromKeypair(
    umi,
    umi.eddsa.createKeypairFromSecretKey(escrowKeypair.secretKey)
  )
  umi.use(signerIdentity(umiEscrowSigner))

  const mintPk = umiPublicKey(mint)
  const destPk = umiPublicKey(destinationOwner)

  const standards = [TokenStandard.NonFungible, TokenStandard.ProgrammableNonFungible]
  let lastErr: string | null = null

  for (const tokenStandard of standards) {
    try {
      const tb = transferV1(umi, {
        mint: mintPk,
        destinationOwner: destPk,
        tokenStandard,
      })
      const built = await tb.buildWithLatestBlockhash(umi)
      const innerLegacy = toWeb3JsLegacyTransaction(built)

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction()
      innerLegacy.instructions.forEach((ix) => tx.add(ix))
      tx.recentBlockhash = blockhash
      tx.feePayer = escrowKeypair.publicKey
      tx.sign(escrowKeypair)

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight,
        preflightCommitment: 'confirmed',
      })
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
      return { signature: sig }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  if (lastErr) {
    console.info(
      'Token Metadata escrow payout did not succeed; falling back to SPL transfer if applicable. Last error:',
      lastErr
    )
  }
  return null
}
