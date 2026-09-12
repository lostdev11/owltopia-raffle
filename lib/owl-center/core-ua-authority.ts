import 'server-only'

import { fetchCollection } from '@metaplex-foundation/mpl-core'
import { publicKey, type Umi } from '@metaplex-foundation/umi'

/** True when the Umi identity is root UA or listed on UpdateDelegate.additionalDelegates. */
export async function coreCollectionAllowsUmiUpdates(
  umi: Umi,
  collectionAddress: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const collection = await fetchCollection(umi, publicKey(collectionAddress.trim()))
    const identity = String(umi.identity.publicKey)
    const updateAuthority = String(collection.updateAuthority)
    if (updateAuthority === identity) return { ok: true }
    const delegates = (collection.updateDelegate?.additionalDelegates ?? []).map(String)
    if (delegates.includes(identity)) return { ok: true }
    return {
      ok: false,
      reason: `Ops delegate unavailable — collection update authority is ${updateAuthority.slice(0, 8)}… and the platform signer is not listed as UpdateDelegate.`,
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
