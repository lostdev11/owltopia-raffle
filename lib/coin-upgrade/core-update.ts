import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createSignerFromKeypair,
  publicKey as umiPublicKey,
  signerIdentity,
} from '@metaplex-foundation/umi'
import { fetchAsset, fetchCollection, update } from '@metaplex-foundation/mpl-core'
import { StakingUserError } from '@/lib/nesting/errors'
import { resolveCoinArtUpdateAuthorityKeypair } from '@/lib/coin-upgrade/update-authority-keypair'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

function signatureToString(result: unknown): string {
  const sig = (result as { signature?: unknown })?.signature ?? result
  if (sig instanceof Uint8Array) return bs58.encode(sig)
  if (Array.isArray(sig)) return bs58.encode(Uint8Array.from(sig))
  return String(sig)
}

async function createCoinUpdateAuthorityUmi() {
  const authority = await resolveCoinArtUpdateAuthorityKeypair()
  if (!authority) {
    throw new StakingUserError(
      'Coin art upgrade hot key is not configured. Create one in Admin → Coin art upgrade (or set COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY).',
      503
    )
  }

  const endpoint = resolveServerSolanaRpcUrl()
  const umi: any = (createUmi as any)(endpoint as any)
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(authority.secretKey)
  const signer = createSignerFromKeypair(umi, umiKeypair)
  umi.use(signerIdentity(signer))
  return { umi, signer }
}

export type CoinAssetUriUpdateResult = {
  signature: string | null
  previousUri: string
  name: string
  ownerWallet: string
}

/**
 * Repoints an Owltopia coin MPL Core asset URI to the new art, signed by the
 * server update authority. The nest FreezeDelegate lock (frozen: true) does
 * NOT block this — freeze only gates transfers/burns — so nested coins upgrade
 * in place without unlocking.
 */
export async function updateCoinAssetUriOnChain(params: {
  assetId: string
  newUri: string
}): Promise<CoinAssetUriUpdateResult> {
  const assetId = params.assetId.trim()
  const newUri = params.newUri.trim()
  if (!assetId || !newUri) {
    throw new StakingUserError('Asset id and new URI are required for a coin art upgrade.', 400)
  }

  const { umi } = await createCoinUpdateAuthorityUmi()
  const asset = await fetchAsset(umi as any, umiPublicKey(assetId))
  const previousUri = String((asset as any)?.uri ?? '')
  const name = String((asset as any)?.name ?? '')
  const ownerWallet = String((asset as any)?.owner ?? '')

  if (previousUri === newUri) {
    // Already repointed (retry after a lost response) — nothing to send.
    return { signature: null, previousUri, name, ownerWallet }
  }

  const collectionAddress =
    (asset as any)?.updateAuthority?.type === 'Collection'
      ? String((asset as any).updateAuthority.address)
      : ''
  const collection = collectionAddress
    ? await fetchCollection(umi as any, umiPublicKey(collectionAddress))
    : undefined

  try {
    const result = await update(umi as any, {
      asset,
      ...(collection ? { collection } : {}),
      uri: newUri,
    } as any).sendAndConfirm(umi as any)
    return { signature: signatureToString(result), previousUri, name, ownerWallet }
  } catch (e) {
    throw new StakingUserError(
      e instanceof Error ? e.message : 'MPL Core metadata update failed.',
      503
    )
  }
}
