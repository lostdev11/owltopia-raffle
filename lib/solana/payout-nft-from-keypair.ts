/**
 * Server-signed Core / compressed NFT payouts from an arbitrary source keypair
 * (prize escrow, packs vault, marketplace escrow).
 */
import { Keypair } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createSignerFromKeypair,
  publicKey as umiPublicKey,
  signerIdentity,
} from '@metaplex-foundation/umi'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import { getAssetWithProof, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum'
import { fetchAsset, transferV1 } from '@metaplex-foundation/mpl-core'
import { buildBubblegumLeafTransferBuilder } from '@/lib/solana/bubblegum-leaf-transfer'
import { umiSignatureToBase58 } from '@/lib/solana/umi-signature'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export type KeypairNftPayoutResult =
  | { ok: true; signature: string }
  | { ok: false; error: string }

/** MPL Core: transfer asset from `keypair` to recipient. */
export async function payoutMplCoreFromKeypair(
  keypair: Keypair,
  assetId: string,
  recipientWallet: string
): Promise<KeypairNftPayoutResult> {
  const trimmedAsset = assetId.trim()
  const recipient = recipientWallet.trim()
  if (!trimmedAsset) return { ok: false, error: 'Missing Core asset id' }
  if (!recipient) return { ok: false, error: 'Missing recipient wallet' }

  try {
    const endpoint = resolveServerSolanaRpcUrl()
    const umi: any = (createUmi as any)(endpoint as any)
    const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypair.secretKey)
    const signer = createSignerFromKeypair(umi, umiKeypair)
    umi.use(signerIdentity(signer))

    const asset = umiPublicKey(trimmedAsset)
    const newOwner = umiPublicKey(recipient)
    const assetAccount: any = await fetchAsset(umi as any, asset)
    const maybeCollection: any =
      assetAccount?.updateAuthority?.type === 'Collection'
        ? assetAccount.updateAuthority.address
        : undefined

    const builder: any = transferV1(umi as any, {
      asset,
      newOwner,
      ...(maybeCollection ? { collection: maybeCollection } : {}),
    } as any)
    const result: any = await builder.sendAndConfirm(umi as any)
    return { ok: true, signature: umiSignatureToBase58(result) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Compressed (Bubblegum): transfer leaf from `keypair` to recipient. Requires DAS RPC. */
export async function payoutCompressedFromKeypair(
  keypair: Keypair,
  assetId: string,
  recipientWallet: string
): Promise<KeypairNftPayoutResult> {
  const trimmedAsset = assetId.trim()
  const recipient = recipientWallet.trim()
  if (!trimmedAsset) return { ok: false, error: 'Missing compressed NFT asset id' }
  if (!recipient) return { ok: false, error: 'Missing recipient wallet' }

  const sourceBase58 = keypair.publicKey.toBase58()
  const endpoint = resolveServerSolanaRpcUrl()

  try {
    const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())
    const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypair.secretKey)
    const signer = createSignerFromKeypair(umi, umiKeypair)
    umi.use(signerIdentity(signer))

    const asset: any = await getAssetWithProof(umi, umiPublicKey(trimmedAsset), {
      truncateCanopy: true,
    })
    const leafOwnerStr = asset?.leafOwner ? String(asset.leafOwner) : ''
    if (leafOwnerStr !== sourceBase58) {
      return {
        ok: false,
        error:
          'Compressed NFT is not held by this wallet under this asset id, or the asset is not compressed.',
      }
    }

    const builder: any = await buildBubblegumLeafTransferBuilder(
      umi,
      signer,
      umiPublicKey(sourceBase58),
      umiPublicKey(recipient),
      asset
    )
    const result: any = await builder.sendAndConfirm(umi)
    return { ok: true, signature: umiSignatureToBase58(result) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
