import { PublicKey } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createSignerFromKeypair,
  publicKey as umiPublicKey,
  signerIdentity,
} from '@metaplex-foundation/umi'
import { fetchAsset, fetchCollection, freezeAsset, thawAsset } from '@metaplex-foundation/mpl-core'
import bs58 from 'bs58'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { resolveWalletOwlNestCollectionAddress } from '@/lib/nesting/owl-nest-collection'
import { StakingUserError } from '@/lib/nesting/errors'
import {
  getNestingNftFreezeAuthorityKeypair,
  getNestingNftFreezeAuthorityWallet,
} from '@/lib/nesting/freeze-authority-keypair'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

type HeliusAssetResult = {
  id?: string
  ownership?: {
    owner?: string
  }
  grouping?: Array<{
    group_key?: string
    group_value?: string
  }>
}

function resolveCollectionForFreezeCheck(collectionMint?: string | null): string {
  const fromPool = collectionMint?.trim()
  if (fromPool) return fromPool
  return resolveWalletOwlNestCollectionAddress()
}

async function assertAssetOwnedByWalletInCollection(params: {
  assetId: string
  ownerWallet: string
  collectionMint?: string | null
}): Promise<void> {
  const heliusUrl = getHeliusMainnetRpcUrl()
  if (!heliusUrl) {
    throw new StakingUserError('HELIUS_API_KEY is required for Owl Nest NFT checks.', 503)
  }

  const requiredCollection = resolveCollectionForFreezeCheck(params.collectionMint)
  if (!requiredCollection) {
    throw new StakingUserError(
      'NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS (or OWLTOPIA_COLLECTION_ADDRESS) is required.',
      503
    )
  }

  const assetId = params.assetId.trim()
  const collectionKey = requiredCollection.trim()
  if (assetId === collectionKey) {
    throw new StakingUserError(
      'That address is the collection (contract) mint, not an individual NFT. Open your wallet’s NFT list and paste the asset mint for the Owl Nest you want to nest.',
      400
    )
  }
  const ownerWallet = params.ownerWallet.trim()
  if (!assetId) throw new StakingUserError('asset_identifier is required for NFT staking.', 400)
  if (!ownerWallet) throw new StakingUserError('Wallet is required for NFT staking.', 400)

  const res = await fetch(heliusUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'nesting-nft-freeze-check',
      method: 'getAsset',
      params: { id: assetId },
    }),
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new StakingUserError(`Unable to verify NFT ownership (Helius status ${res.status}).`, 502)
  }

  const json = (await res.json().catch(() => null)) as
    | { result?: HeliusAssetResult; error?: { message?: string } }
    | null

  if (!json || json.error || !json.result) {
    throw new StakingUserError(
      `Unable to read NFT metadata for freeze verification${json?.error?.message ? `: ${json.error.message}` : ''}.`,
      502
    )
  }

  const owner = json.result.ownership?.owner?.trim() || ''
  if (!owner || owner !== ownerWallet) {
    throw new StakingUserError('NFT is not currently in the staking wallet.', 400)
  }

  const inCollection =
    Array.isArray(json.result.grouping) &&
    json.result.grouping.some(
      (g) => typeof g?.group_value === 'string' && g.group_value === collectionKey
    )
  if (!inCollection) {
    throw new StakingUserError('NFT is not part of the configured Owltopia Coin collection.', 400)
  }
}

function signatureToString(result: any): string {
  const sig = result?.signature ?? result
  if (sig instanceof Uint8Array) return bs58.encode(sig)
  if (Array.isArray(sig)) return bs58.encode(Uint8Array.from(sig))
  return String(sig)
}

async function createCoreAuthorityUmi() {
  const authority = getNestingNftFreezeAuthorityKeypair()
  if (!authority) {
    throw new StakingUserError(
      'NESTING_NFT_FREEZE_AUTHORITY_SECRET_KEY is required for MPL Core NFT staking locks.',
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

async function fetchCoreAssetAndCollection(umi: any, assetId: string, collectionMint?: string | null) {
  const asset = await fetchAsset(umi as any, umiPublicKey(assetId))
  const collectionAddress =
    collectionMint?.trim() ||
    ((asset as any)?.updateAuthority?.type === 'Collection'
      ? String((asset as any).updateAuthority.address)
      : '')
  const collection = collectionAddress
    ? await fetchCollection(umi as any, umiPublicKey(collectionAddress))
    : undefined
  return { asset, collection }
}

function corePluginAlreadyFrozen(asset: any): boolean {
  return asset?.freezeDelegate?.frozen === true
}

export function getNestingNftFreezeDelegateAddress(): string {
  const configured = getNestingNftFreezeAuthorityWallet()
  if (configured) return configured
  return getNestingNftFreezeAuthorityKeypair()?.publicKey.toBase58() ?? ''
}

function coreFreezeDelegateAuthorityMatches(asset: any, delegateAddress: string): boolean {
  const authority = asset?.freezeDelegate?.authority
  if (!authority || !delegateAddress) return false
  const address = authority.address ?? authority.pubkey ?? authority.publicKey
  return Boolean(address) && String(address) === delegateAddress
}

export async function assertWalletNftFrozenForNesting(params: {
  ownerWallet: string
  assetId: string
  collectionMint?: string | null
}): Promise<{ tokenAccount: string }> {
  await assertAssetOwnedByWalletInCollection(params)

  try {
    new PublicKey(params.ownerWallet.trim())
    new PublicKey(params.assetId.trim())
  } catch {
    throw new StakingUserError('Invalid wallet or NFT asset address.', 400)
  }

  const { umi, signer } = await createCoreAuthorityUmi()
  const { asset, collection } = await fetchCoreAssetAndCollection(umi, params.assetId.trim(), params.collectionMint)
  const delegateAddress = signer.publicKey.toString()

  if (corePluginAlreadyFrozen(asset) && coreFreezeDelegateAuthorityMatches(asset, delegateAddress)) {
    return { tokenAccount: params.assetId.trim() }
  }

  try {
    const result = await freezeAsset(umi as any, {
      asset,
      ...(collection ? { collection } : {}),
      authority: signer,
      delegate: signer,
    } as any).sendAndConfirm(umi as any)
    const refreshed = await fetchAsset(umi as any, umiPublicKey(params.assetId.trim()))
    if (!corePluginAlreadyFrozen(refreshed)) {
      throw new Error('MPL Core asset is not frozen after freeze attempt.')
    }
    return { tokenAccount: params.assetId.trim() }
  } catch (e) {
    throw new StakingUserError(
      e instanceof Error ? e.message : 'MPL Core freeze verification failed.',
      503
    )
  }
}

export async function thawWalletNftForNesting(params: {
  ownerWallet: string
  assetId: string
  collectionMint?: string | null
}): Promise<{ signature: string | null; tokenAccount: string }> {
  await assertAssetOwnedByWalletInCollection(params)

  try {
    new PublicKey(params.ownerWallet.trim())
    new PublicKey(params.assetId.trim())
  } catch {
    throw new StakingUserError('Invalid wallet or NFT asset address.', 400)
  }

  const { umi, signer } = await createCoreAuthorityUmi()
  const { asset, collection } = await fetchCoreAssetAndCollection(umi, params.assetId.trim(), params.collectionMint)

  if (!corePluginAlreadyFrozen(asset)) {
    return { signature: null, tokenAccount: params.assetId.trim() }
  }

  try {
    const result = await thawAsset(umi as any, {
      asset,
      ...(collection ? { collection } : {}),
      delegate: signer,
    } as any).sendAndConfirm(umi as any)
    return { signature: signatureToString(result), tokenAccount: params.assetId.trim() }
  } catch (e) {
    throw new StakingUserError(
      e instanceof Error ? e.message : 'MPL Core thaw delegate failed.',
      503
    )
  }
}
