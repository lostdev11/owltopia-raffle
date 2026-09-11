import 'server-only'

import {
  addCollectionPlugin,
  fetchCollection,
  updateCollection,
  updateCollectionPlugin,
} from '@metaplex-foundation/mpl-core'
import { publicKey, type Umi } from '@metaplex-foundation/umi'

import { validateSolanaPubkeyInput } from '@/lib/solana/validate-pubkey'

export type CoreUaHandoffResult =
  | {
      ok: true
      updateAuthority: string
      platformDelegate: string
      alreadyHandedOff?: boolean
    }
  | { ok: false; error: string }

export { isOwlCenterCreatorUaHandoffEnabled } from '@/lib/owl-center/creator-ua-flags'
import { isOwlCenterCreatorUaHandoffEnabled } from '@/lib/owl-center/creator-ua-flags'

function delegateList(collection: {
  updateDelegate?: { additionalDelegates?: readonly unknown[] } | null
}): string[] {
  return (collection.updateDelegate?.additionalDelegates ?? []).map(String)
}

/**
 * Ensure IRYS remains UpdateDelegate, then transfer root collection update authority
 * to creatorWallet. Idempotent when already handed off.
 *
 * Must only run AFTER Core Candy Machine create (CM create requires collection UA as signer).
 */
export async function handOffCoreCollectionUpdateAuthority(params: {
  umi: Umi
  collectionAddress: string
  creatorWallet: string
}): Promise<CoreUaHandoffResult> {
  const collectionAddress = params.collectionAddress.trim()
  const creatorCheck = validateSolanaPubkeyInput(params.creatorWallet.trim(), 'Creator wallet')
  if (!creatorCheck.ok) {
    return { ok: false, error: creatorCheck.error }
  }
  const creatorWallet = creatorCheck.pubkey
  const platformDelegate = String(params.umi.identity.publicKey)

  try {
    const collectionPk = publicKey(collectionAddress)
    let collection = await fetchCollection(params.umi, collectionPk)
    let updateAuthority = String(collection.updateAuthority)
    let delegates = delegateList(collection)

    if (updateAuthority === creatorWallet && delegates.includes(platformDelegate)) {
      return {
        ok: true,
        updateAuthority: creatorWallet,
        platformDelegate,
        alreadyHandedOff: true,
      }
    }

    if (updateAuthority !== platformDelegate && updateAuthority !== creatorWallet) {
      return {
        ok: false,
        error: `Collection update authority is ${updateAuthority.slice(0, 8)}… — Owltopia deployer cannot hand it off.`,
      }
    }

    // While IRYS is still root UA (or already creator with missing delegate), ensure UpdateDelegate.
    if (updateAuthority === platformDelegate && !delegates.includes(platformDelegate)) {
      if (collection.updateDelegate) {
        const next = [...new Set([...delegates, platformDelegate])]
        await updateCollectionPlugin(params.umi, {
          collection: collectionPk,
          plugin: {
            type: 'UpdateDelegate',
            additionalDelegates: next.map((d) => publicKey(d)),
          },
        }).sendAndConfirm(params.umi, { confirm: { commitment: 'confirmed' } })
      } else {
        await addCollectionPlugin(params.umi, {
          collection: collectionPk,
          plugin: {
            type: 'UpdateDelegate',
            additionalDelegates: [publicKey(platformDelegate)],
          },
        }).sendAndConfirm(params.umi, { confirm: { commitment: 'confirmed' } })
      }
      collection = await fetchCollection(params.umi, collectionPk)
      updateAuthority = String(collection.updateAuthority)
      delegates = delegateList(collection)
    }

    if (updateAuthority === platformDelegate) {
      await updateCollection(params.umi, {
        collection: collectionPk,
        newUpdateAuthority: publicKey(creatorWallet),
      }).sendAndConfirm(params.umi, { confirm: { commitment: 'confirmed' } })
      collection = await fetchCollection(params.umi, collectionPk)
      updateAuthority = String(collection.updateAuthority)
      delegates = delegateList(collection)
    }

    // Creator already owns UA but platform delegate missing — cannot add without creator signature.
    if (updateAuthority === creatorWallet && !delegates.includes(platformDelegate)) {
      return {
        ok: false,
        error:
          'Creator already owns update authority, but Owltopia is not an UpdateDelegate. Re-run handoff before transferring UA, or have the creator authorize the platform delegate.',
      }
    }

    if (updateAuthority !== creatorWallet) {
      return {
        ok: false,
        error: `Handoff incomplete — on-chain update authority is still ${updateAuthority.slice(0, 8)}…`,
      }
    }

    return {
      ok: true,
      updateAuthority: creatorWallet,
      platformDelegate,
      alreadyHandedOff: false,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Read-only on-chain authority snapshot for UI / Orbis gating. */
export async function fetchCoreCollectionAuthorityStatus(params: {
  umi: Umi
  collectionAddress: string
  creatorWallet: string | null | undefined
  platformDelegate: string
}): Promise<{
  updateAuthority: string
  platformDelegateListed: boolean
  creatorOwnsUa: boolean
  canClaim: boolean
}> {
  const collection = await fetchCollection(params.umi, publicKey(params.collectionAddress.trim()))
  const updateAuthority = String(collection.updateAuthority)
  const delegates = delegateList(collection)
  const platformDelegateListed = delegates.includes(params.platformDelegate)
  const creator = params.creatorWallet?.trim() || ''
  const creatorOwnsUa = Boolean(creator && updateAuthority === creator)
  const canClaim = Boolean(
    creator && updateAuthority === params.platformDelegate && isOwlCenterCreatorUaHandoffEnabled()
  )
  return {
    updateAuthority,
    platformDelegateListed,
    creatorOwnsUa,
    canClaim,
  }
}
