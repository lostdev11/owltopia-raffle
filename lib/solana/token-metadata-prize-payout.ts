/**
 * Server-side payout for SPL Token–program NFTs held in prize escrow using Metaplex Token Metadata
 * transferV1 — same path as the wallet deposit flow in token-metadata-transfer.ts.
 * Raw SPL TransferInstruction fails for many programmable / freeze-authority NFTs that still move
 * normally via Token Metadata in Phantom and other wallets.
 */
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createSignerFromKeypair,
  publicKey as umiPublicKey,
  signerIdentity,
  unwrapOption,
} from '@metaplex-foundation/umi'
import type { DigitalAssetWithToken } from '@metaplex-foundation/mpl-token-metadata'
import {
  fetchDigitalAssetWithAssociatedToken,
  mplTokenMetadata,
  transferV1,
  TokenStandard,
} from '@metaplex-foundation/mpl-token-metadata'
import { toWeb3JsLegacyTransaction } from '@metaplex-foundation/umi-web3js-adapters'

/**
 * Metaplex Token Metadata error **159** = **Missing token record account**. Generated `transferV1` only
 * derives Token Record PDAs when `tokenStandard === ProgrammableNonFungible`. Using `NonFungible` on a pNFT
 * omits those accounts → 159 on-chain. We resolve the mint's Token Metadata (and Token Record presence) first.
 */
function tokenStandardsToTryForEscrowMint(
  onChainStandard: TokenStandard | null | undefined,
  escrowHasTokenRecord: boolean
): TokenStandard[] {
  if (
    onChainStandard === TokenStandard.ProgrammableNonFungible ||
    onChainStandard === TokenStandard.ProgrammableNonFungibleEdition
  ) {
    return [TokenStandard.ProgrammableNonFungible]
  }
  if (onChainStandard === TokenStandard.NonFungible || onChainStandard === TokenStandard.NonFungibleEdition) {
    return [TokenStandard.NonFungible]
  }
  // Legacy / ambiguous metadata: Token Record implies pNFT mechanics.
  if (escrowHasTokenRecord) {
    return [TokenStandard.ProgrammableNonFungible, TokenStandard.NonFungible]
  }
  return [TokenStandard.NonFungible, TokenStandard.ProgrammableNonFungible]
}

function authorizationRulesFromFetchedAsset(asset: DigitalAssetWithToken) {
  const pc = unwrapOption(asset.metadata.programmableConfig)
  if (!pc || pc.__kind !== 'V1') return undefined
  const pk = unwrapOption(pc.ruleSet)
  return pk ? umiPublicKey(pk) : undefined
}

export type TokenMetadataEscrowPayoutParams = {
  connection: Connection
  escrowKeypair: Keypair
  mint: PublicKey
  destinationOwner: PublicKey
  skipPreflight?: boolean
}

/**
 * Token Metadata transfer from escrow to destination, using on-chain metadata to pick the token standard
 * (avoids programmable NFT transfers without token-record accounts).
 *
 * Returns null if no attempt succeeds (caller may fall back to raw SPL transfer).
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

  let standards: TokenStandard[] = [
    TokenStandard.ProgrammableNonFungible,
    TokenStandard.NonFungible,
  ]
  let authorizationRules: ReturnType<typeof umiPublicKey> | undefined
  try {
    const asset = await fetchDigitalAssetWithAssociatedToken(umi, mintPk, umiEscrowSigner.publicKey)
    const fromMeta = unwrapOption(asset.metadata.tokenStandard)
    standards = tokenStandardsToTryForEscrowMint(fromMeta, asset.tokenRecord != null)
    authorizationRules = authorizationRulesFromFetchedAsset(asset)
  } catch (e) {
    console.info(
      '[trySendSplNftViaTokenMetadataFromEscrow] Could not fetch digital asset; using pNFT-first heuristic.',
      e instanceof Error ? e.message : e
    )
  }

  let lastErr: string | null = null

  for (const tokenStandard of standards) {
    try {
      const tb = transferV1(umi, {
        mint: mintPk,
        destinationOwner: destPk,
        tokenStandard,
        ...(authorizationRules ? { authorizationRules } : {}),
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
