import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchAsset } from '@metaplex-foundation/mpl-core'
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi'
import {
  assetOwnerAddress,
  isMplCoreNestingLockHeld,
  mplCoreNestCanServerRefreeze,
  mplCoreNestNeedsWalletRelock,
  readMplCoreFreezeDelegate,
} from '@/lib/solana/mpl-core-nest-lock'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { StakingUserError } from '@/lib/nesting/errors'
import { getNestingNftFreezeDelegateAddress } from '@/lib/nesting/nft-freeze'

export const GOMT_LABZ_STAKING_URL = 'https://www.gotmlabz.io/nftstake/owltopia'

export type NftStakeEligibilityCode =
  | 'externally_frozen'
  | 'incompatible_freeze_delegate'
  | 'owltopia_lock_held'
  | 'wrong_owner'

export type NftStakeEligibility =
  | { eligible: true }
  | { eligible: false; reason: string; code: NftStakeEligibilityCode }

export type WalletNestMintRow = {
  mint: string
  name: string | null
  image: string | null
  stake_blocked?: boolean
  stake_block_reason?: string | null
  stake_block_code?: NftStakeEligibilityCode | null
}

function externalNestFreezeMessage(): string {
  return (
    'This NFT is frozen by another staking program (for example GOMT Labz). ' +
    'Unstake or wait for the lock to end there before nesting on Owltopia.'
  )
}

function incompatibleDelegateMessage(): string {
  return (
    'This NFT has a freeze lock from another program that Owltopia cannot override. ' +
    'Unstake elsewhere first, then try again.'
  )
}

/** Read-only MPL Core check: can this NFT start a new Owltopia nest? */
export function readNftStakeFreezeEligibilityFromAsset(params: {
  asset: unknown
  ownerWallet: string
  nestingDelegateAddress: string
}): NftStakeEligibility {
  const ownerWallet = params.ownerWallet.trim()
  const delegate = params.nestingDelegateAddress.trim()
  const asset = params.asset

  if (assetOwnerAddress(asset) !== ownerWallet) {
    return { eligible: false, reason: 'NFT is not in this wallet.', code: 'wrong_owner' }
  }

  if (
    delegate &&
    isMplCoreNestingLockHeld({
      asset,
      nestingDelegateAddress: delegate,
      ownerWallet,
    })
  ) {
    return {
      eligible: false,
      reason:
        'This NFT is already locked for an Owltopia nest. Finish or leave that nest before opening another.',
      code: 'owltopia_lock_held',
    }
  }

  const fd = readMplCoreFreezeDelegate(asset)
  if (!fd || !delegate) {
    return { eligible: true }
  }

  const needsRelock = mplCoreNestNeedsWalletRelock({
    asset,
    nestingDelegateAddress: delegate,
    ownerWallet,
  })
  const canServerRefreeze = mplCoreNestCanServerRefreeze({
    asset,
    nestingDelegateAddress: delegate,
  })

  if (fd.frozen && !needsRelock && !canServerRefreeze) {
    return {
      eligible: false,
      reason: externalNestFreezeMessage(),
      code: 'externally_frozen',
    }
  }

  if (!fd.frozen && !needsRelock && !canServerRefreeze && fd.authorityType === 'Address') {
    return {
      eligible: false,
      reason: incompatibleDelegateMessage(),
      code: 'incompatible_freeze_delegate',
    }
  }

  return { eligible: true }
}

export async function readNftStakeFreezeEligibility(params: {
  assetId: string
  ownerWallet: string
  nestingDelegateAddress?: string | null
}): Promise<NftStakeEligibility> {
  const assetId = params.assetId.trim()
  const ownerWallet = params.ownerWallet.trim()
  if (!assetId || !ownerWallet) {
    return { eligible: false, reason: 'Invalid NFT or wallet.', code: 'wrong_owner' }
  }

  const delegate = (params.nestingDelegateAddress ?? getNestingNftFreezeDelegateAddress()).trim()

  try {
    const endpoint = resolveServerSolanaRpcUrl()
    const umi = createUmi(endpoint)
    const asset = await fetchAsset(umi, umiPublicKey(assetId))
    return readNftStakeFreezeEligibilityFromAsset({ asset, ownerWallet, nestingDelegateAddress: delegate })
  } catch {
    // Non–MPL Core or RPC hiccup — do not hide the NFT; stake flow may still fail with a clearer wallet error.
    return { eligible: true }
  }
}

export async function assertNftEligibleForOwltopiaStake(params: {
  assetId: string
  ownerWallet: string
}): Promise<void> {
  const result = await readNftStakeFreezeEligibility(params)
  if (!result.eligible) {
    throw new StakingUserError(result.reason, 400, { code: result.code, asset_id: params.assetId.trim() })
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  limit = 8
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit)
    out.push(...(await Promise.all(chunk.map(mapper))))
  }
  return out
}

/** Attach `stake_blocked` flags for wallet picker UI (GOMT / external freeze). */
export async function enrichWalletNestMintsWithStakeEligibility(
  mints: Array<{ mint: string; name: string | null; image: string | null }>,
  ownerWallet: string
): Promise<WalletNestMintRow[]> {
  if (mints.length === 0) return []
  const delegate = getNestingNftFreezeDelegateAddress()

  return mapWithConcurrency(mints, async (row) => {
    const result = await readNftStakeFreezeEligibility({
      assetId: row.mint,
      ownerWallet,
      nestingDelegateAddress: delegate,
    })
    if (result.eligible) return { ...row, stake_blocked: false, stake_block_reason: null, stake_block_code: null }
    return {
      ...row,
      stake_blocked: true,
      stake_block_reason: result.reason,
      stake_block_code: result.code,
    }
  })
}
