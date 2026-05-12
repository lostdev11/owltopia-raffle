import { StakingUserError } from '@/lib/nesting/errors'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import { resolveWalletOwlNestCollectionAddress } from '@/lib/nesting/owl-nest-collection'
import { getNestingEscrowKeypair, getNestingEscrowWalletAddress } from '@/lib/nesting/escrow-keypair'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { createSignerFromKeypair, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi'
import { fetchAsset, transferV1 } from '@metaplex-foundation/mpl-core'

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

function resolveCollectionForCustodyCheck(collectionMint?: string | null): string {
  const fromPool = collectionMint?.trim()
  if (fromPool) return fromPool
  return resolveWalletOwlNestCollectionAddress()
}

function getRequiredEscrowWalletAddress(): string {
  return getNestingEscrowWalletAddress()
}

/**
 * Ensures a Metaplex Core asset is in the configured collection and currently owned
 * by the configured escrow wallet. This is our custody gate for on-chain staking pools.
 *
 * Uses `collectionMint` when provided (staking pool `collection_key`) so a gen-2 perch can
 * verify a different Core collection without changing global env; otherwise falls back to
 * `NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS` / `OWLTOPIA_COLLECTION_ADDRESS` (same as DAS picker).
 */
export async function assertMetaplexCoreAssetInEscrow(params: {
  assetId: string
  collectionMint?: string | null
}): Promise<void> {
  const heliusUrl = getHeliusMainnetRpcUrl()
  if (!heliusUrl) {
    throw new StakingUserError('HELIUS_API_KEY is required for Metaplex Core custody checks.', 503)
  }

  const requiredCollection = resolveCollectionForCustodyCheck(params.collectionMint)
  if (!requiredCollection) {
    throw new StakingUserError(
      'NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS (or OWLTOPIA_COLLECTION_ADDRESS) is required.',
      503
    )
  }

  const escrowWallet = getRequiredEscrowWalletAddress()
  if (!escrowWallet) {
    throw new StakingUserError('NESTING_ESCROW_WALLET_ADDRESS is required for staking custody.', 503)
  }

  const assetId = params.assetId.trim()
  if (!assetId) {
    throw new StakingUserError('asset_identifier is required for NFT staking.', 400)
  }

  const res = await fetch(heliusUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'nesting-core-custody-check',
      method: 'getAsset',
      params: { id: assetId },
    }),
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new StakingUserError(`Unable to verify custody (Helius status ${res.status}).`, 502)
  }

  const json = (await res.json().catch(() => null)) as
    | { result?: HeliusAssetResult; error?: { message?: string } }
    | null

  if (!json || json.error || !json.result) {
    throw new StakingUserError(
      `Unable to read NFT asset metadata for custody verification${json?.error?.message ? `: ${json.error.message}` : ''}.`,
      502
    )
  }

  const owner = json.result.ownership?.owner?.trim() || ''
  if (!owner || owner !== escrowWallet) {
    throw new StakingUserError('NFT is not currently held in the staking escrow wallet.', 400)
  }

  const inCollection =
    Array.isArray(json.result.grouping) &&
    json.result.grouping.some(
      (g) => typeof g?.group_value === 'string' && g.group_value === requiredCollection
    )
  if (!inCollection) {
    throw new StakingUserError(
      'NFT is not part of the configured Owltopia Coin collection.',
      400
    )
  }
}

export async function transferMetaplexCoreAssetFromNestingEscrow(params: {
  assetId: string
  recipientWallet: string
  collectionMint?: string | null
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const assetId = params.assetId.trim()
  const recipientWallet = params.recipientWallet.trim()
  if (!assetId) return { ok: false, error: 'NFT asset id is missing.' }
  if (!recipientWallet) return { ok: false, error: 'Recipient wallet is missing.' }

  const keypair = getNestingEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'NESTING_ESCROW_SECRET_KEY is required for NFT unstake release.' }
  }

  const expectedEscrow = getRequiredEscrowWalletAddress()
  if (!expectedEscrow || keypair.publicKey.toBase58() !== expectedEscrow) {
    return { ok: false, error: 'Configured nesting escrow signer does not match NESTING_ESCROW_WALLET_ADDRESS.' }
  }

  try {
    await assertMetaplexCoreAssetInEscrow({ assetId, collectionMint: params.collectionMint })
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'NFT is not currently held in nesting escrow.',
    }
  }

  try {
    const endpoint = resolveServerSolanaRpcUrl()
    const umi: any = (createUmi as any)(endpoint as any)
    const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypair.secretKey)
    const signer = createSignerFromKeypair(umi, umiKeypair)
    umi.use(signerIdentity(signer))

    const asset = umiPublicKey(assetId)
    const newOwner = umiPublicKey(recipientWallet)
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
    return { ok: true, signature: String(result.signature ?? result) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'NFT release transfer failed.' }
  }
}
