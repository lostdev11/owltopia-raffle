import { PublicKey } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createSignerFromKeypair,
  publicKey as umiPublicKey,
  signerIdentity,
} from '@metaplex-foundation/umi'
import { fetchAsset, fetchCollection, thawAsset, updatePlugin } from '@metaplex-foundation/mpl-core'
import {
  assetOwnerAddress,
  isMplCoreNestingLockHeld,
  mplCoreNestCanServerRefreeze,
  mplCoreNestNeedsWalletRelock,
  readMplCoreFreezeDelegate,
} from '@/lib/solana/mpl-core-nest-lock'
import bs58 from 'bs58'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { dasAssetBelongsToCollection } from '@/lib/helius/das-asset-collection'
import {
  CANONICAL_OWL_NEST_365_COLLECTION_ADDRESS,
  LEGACY_OWL_NEST_COLLECTION_ADDRESS,
  resolveWalletOwlNestCollectionAddress,
} from '@/lib/nesting/owl-nest-collection'
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

function resolveCollectionCandidatesForFreezeCheck(collectionMint?: string | null): string[] {
  const out: string[] = []
  const add = (addr: string | null | undefined) => {
    const t = addr?.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  add(collectionMint)
  add(resolveWalletOwlNestCollectionAddress())
  add(CANONICAL_OWL_NEST_365_COLLECTION_ADDRESS)
  add(LEGACY_OWL_NEST_COLLECTION_ADDRESS)
  return out
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

  const collectionCandidates = resolveCollectionCandidatesForFreezeCheck(params.collectionMint)
  if (collectionCandidates.length === 0) {
    throw new StakingUserError(
      'NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS (or OWLTOPIA_COLLECTION_ADDRESS) is required.',
      503
    )
  }

  const assetId = params.assetId.trim()
  if (collectionCandidates.some((key) => assetId === key)) {
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

  const inCollection = collectionCandidates.some((key) =>
    dasAssetBelongsToCollection(json.result, key)
  )
  if (!inCollection) {
    throw new StakingUserError('NFT is not part of the configured Owltopia Coin collection.', 400)
  }
}

/** MPL Core on-chain ownership only (no Helius / collection grouping). */
async function assertMplCoreAssetOwnedByWalletOnChain(params: { assetId: string; ownerWallet: string }): Promise<void> {
  try {
    new PublicKey(params.assetId.trim())
    new PublicKey(params.ownerWallet.trim())
  } catch {
    throw new StakingUserError('Invalid wallet or NFT asset address.', 400)
  }
  const endpoint = resolveServerSolanaRpcUrl()
  const umi: any = (createUmi as any)(endpoint as any)
  const asset = await fetchAsset(umi as any, umiPublicKey(params.assetId.trim()))
  const owner = (asset as any)?.owner?.toString?.()?.trim() || ''
  if (!owner || owner !== params.ownerWallet.trim()) {
    throw new StakingUserError('NFT is not currently in the staking wallet.', 400)
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

/** Lock eligibility / frozen checks only need the asset account (skip collection fetch + RPC 429 risk). */
async function fetchCoreAssetOnly(umi: any, assetId: string) {
  return fetchAsset(umi as any, umiPublicKey(assetId.trim()))
}

async function fetchCoreAssetAndCollection(umi: any, assetId: string, collectionMint?: string | null) {
  const asset = await fetchCoreAssetOnly(umi, assetId)
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

export function getNestingNftFreezeDelegateAddress(): string {
  const configured = getNestingNftFreezeAuthorityWallet()
  if (configured) return configured
  return getNestingNftFreezeAuthorityKeypair()?.publicKey.toBase58() ?? ''
}

export type OwlClaimNftNestLockRead = {
  locked: boolean
  ownerThawedEligible: boolean
}

/** One MPL Core fetch for claim lock checks (avoids duplicate asset reads per nest). */
export async function readOwlClaimNftNestLockEligibility(params: {
  assetId: string
  ownerWallet: string
  collectionMint?: string | null
}): Promise<OwlClaimNftNestLockRead | null> {
  try {
    const { umi, signer } = await createCoreAuthorityUmi()
    const asset = await fetchCoreAssetOnly(umi, params.assetId.trim())
    const ownerWallet = params.ownerWallet.trim()
    const locked = isMplCoreNestingLockHeld({
      asset,
      nestingDelegateAddress: signer.publicKey.toString(),
      ownerWallet,
    })
    const fd = readMplCoreFreezeDelegate(asset)
    const ownerThawedEligible =
      fd?.authorityType === 'Owner' &&
      fd.frozen !== true &&
      assetOwnerAddress(asset) === ownerWallet
    return { locked, ownerThawedEligible }
  } catch {
    return null
  }
}

/** Owner-delegate Owl Nest that is thawed but still in the holder wallet — OK to pay OWL claims without a wallet re-lock. */
export async function isOwnerThawedOwlNestEligibleForClaim(params: {
  assetId: string
  ownerWallet: string
  collectionMint?: string | null
}): Promise<boolean> {
  const state = await readOwlClaimNftNestLockEligibility(params)
  return state?.ownerThawedEligible === true
}

/** Read-only: true when the nest lock is active on-chain (nesting delegate or Owner freeze). */
export async function isWalletNftFrozenForNestingDelegate(params: {
  assetId: string
  collectionMint?: string | null
  ownerWallet?: string | null
}): Promise<boolean> {
  if (!params.ownerWallet?.trim()) {
    try {
      const { umi, signer } = await createCoreAuthorityUmi()
      const { asset } = await fetchCoreAssetAndCollection(umi, params.assetId.trim(), params.collectionMint)
      return isMplCoreNestingLockHeld({
        asset,
        nestingDelegateAddress: signer.publicKey.toString(),
        ownerWallet: params.ownerWallet,
      })
    } catch {
      return false
    }
  }
  const state = await readOwlClaimNftNestLockEligibility({
    assetId: params.assetId,
    ownerWallet: params.ownerWallet,
    collectionMint: params.collectionMint,
  })
  return state?.locked === true
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
  const ownerWallet = params.ownerWallet.trim()

  if (isMplCoreNestingLockHeld({ asset, nestingDelegateAddress: delegateAddress, ownerWallet })) {
    return { tokenAccount: params.assetId.trim() }
  }

  if (
    mplCoreNestNeedsWalletRelock({
      asset,
      nestingDelegateAddress: delegateAddress,
      ownerWallet,
    })
  ) {
    throw new StakingUserError(
      'This Owl Nest coin must be re-locked from your wallet before nesting or claiming. On the nesting dashboard, approve the wallet lock when prompted (or open the nest again for that coin).',
      400,
      { code: 'nest_relock_required', asset_id: params.assetId.trim() }
    )
  }

  if (!mplCoreNestCanServerRefreeze({ asset, nestingDelegateAddress: delegateAddress })) {
    const fd = readMplCoreFreezeDelegate(asset)
    throw new StakingUserError(
      fd
        ? 'This Owl Nest coin has an incompatible on-chain freeze lock. Contact Owltopia support with the coin mint address.'
        : 'This Owl Nest coin is missing a nest lock on-chain. Finish opening the nest in your wallet first.',
      400,
      { code: 'nest_lock_incompatible', asset_id: params.assetId.trim() }
    )
  }

  try {
    await updatePlugin(umi as any, {
      asset,
      ...(collection ? { collection } : {}),
      plugin: { type: 'FreezeDelegate', frozen: true },
    } as any)
      .sendAndConfirm(umi as any)
    const refreshed = await fetchAsset(umi as any, umiPublicKey(params.assetId.trim()))
    if (
      !isMplCoreNestingLockHeld({
        asset: refreshed,
        nestingDelegateAddress: delegateAddress,
        ownerWallet,
      })
    ) {
      throw new Error('MPL Core asset is not frozen after freeze attempt.')
    }
    return { tokenAccount: params.assetId.trim() }
  } catch (e) {
    if (e instanceof StakingUserError) throw e
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
  /**
   * Admin-only: trust MPL Core `asset.owner` on RPC instead of Helius collection grouping.
   * Caller should pass `collectionMint: null` so thaw uses the asset’s real collection from chain.
   */
  adminRecoveryUnstake?: boolean
}): Promise<{ signature: string | null; tokenAccount: string }> {
  if (params.adminRecoveryUnstake === true) {
    await assertMplCoreAssetOwnedByWalletOnChain({
      assetId: params.assetId,
      ownerWallet: params.ownerWallet,
    })
  } else {
    await assertAssetOwnedByWalletInCollection(params)
  }

  try {
    new PublicKey(params.ownerWallet.trim())
    new PublicKey(params.assetId.trim())
  } catch {
    throw new StakingUserError('Invalid wallet or NFT asset address.', 400)
  }

  const { umi, signer } = await createCoreAuthorityUmi()
  const { asset, collection } = await fetchCoreAssetAndCollection(umi, params.assetId.trim(), params.collectionMint)
  const delegateAddress = signer.publicKey.toString()
  const fd = readMplCoreFreezeDelegate(asset)

  if (!fd?.frozen) {
    return { signature: null, tokenAccount: params.assetId.trim() }
  }

  if (fd.authorityType === 'Owner') {
    throw new StakingUserError(
      'This nest uses a wallet-controlled freeze lock. Close the nest from your wallet so it can thaw the coin.',
      400
    )
  }

  if (fd.authorityType !== 'Address' || fd.authorityAddress !== delegateAddress) {
    throw new StakingUserError(
      'This Owl Nest coin has a freeze lock that Owltopia cannot thaw automatically. Contact support.',
      503
    )
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
