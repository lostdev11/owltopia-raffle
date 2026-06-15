import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

const PRE_PUBLIC_STATUSES = new Set(['DRAFT', 'PENDING_REVIEW'])

export type CreatorLaunchDeleteEligibility = {
  deletable: boolean
  reason: string | null
}

function hasOnChainDeploy(launch: Pick<
  OwlCenterLaunchPublic,
  'candy_machine_id' | 'collection_mint' | 'devnet_candy_machine_id' | 'devnet_collection_mint'
>): boolean {
  return Boolean(
    launch.candy_machine_id?.trim() ||
      launch.collection_mint?.trim() ||
      launch.devnet_candy_machine_id?.trim() ||
      launch.devnet_collection_mint?.trim()
  )
}

export function assessCreatorLaunchDeleteEligibility(
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'slug'
    | 'status'
    | 'minted_count'
    | 'candy_machine_id'
    | 'collection_mint'
    | 'devnet_candy_machine_id'
    | 'devnet_collection_mint'
  >
): CreatorLaunchDeleteEligibility {
  if (launch.slug === 'gen2') {
    return { deletable: false, reason: 'Gen2 cannot be deleted from My Launches.' }
  }
  if (launch.minted_count > 0) {
    return {
      deletable: false,
      reason: 'Minting has started — collections with mints cannot be deleted.',
    }
  }
  if (!PRE_PUBLIC_STATUSES.has(launch.status)) {
    return {
      deletable: false,
      reason: 'This collection is live on Owl Center. Contact Owltopia if you need it removed.',
    }
  }
  if (hasOnChainDeploy(launch)) {
    return {
      deletable: false,
      reason: 'Candy Machine already deployed — contact Owltopia before removing this submission.',
    }
  }
  return { deletable: true, reason: null }
}
