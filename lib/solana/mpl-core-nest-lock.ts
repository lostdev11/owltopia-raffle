/**
 * Shared MPL Core nest-lock reads for Owl Nest NFTs (client + server).
 * Many Owltopia coins use FreezeDelegate with Owner authority from the collection;
 * nesting must not call Metaplex `freezeAsset` (it RemovePlugins first → 0x1a).
 */

export type MplCoreFreezeDelegateInfo = {
  frozen: boolean
  authorityType: string | null
  authorityAddress: string | null
}

export function readMplCoreFreezeDelegate(asset: unknown): MplCoreFreezeDelegateInfo | null {
  const fd = (asset as { freezeDelegate?: { frozen?: boolean; authority?: { type?: string; address?: unknown } } })
    ?.freezeDelegate
  if (!fd) return null
  const authority = fd.authority
  const authorityType = typeof authority?.type === 'string' ? authority.type : null
  const authorityAddress =
    authority?.address != null && String(authority.address).trim()
      ? String(authority.address).trim()
      : null
  return {
    frozen: fd.frozen === true,
    authorityType,
    authorityAddress,
  }
}

export function assetOwnerAddress(asset: unknown): string {
  const owner = (asset as { owner?: unknown })?.owner
  return owner != null ? String(owner).trim() : ''
}

/** True when the asset is frozen under our delegate address or under Owner (holder wallet). */
export function isMplCoreNestingLockHeld(params: {
  asset: unknown
  nestingDelegateAddress: string
  ownerWallet?: string | null
}): boolean {
  const fd = readMplCoreFreezeDelegate(params.asset)
  if (!fd?.frozen) return false
  const delegate = params.nestingDelegateAddress.trim()
  if (fd.authorityType === 'Address' && fd.authorityAddress === delegate) return true
  if (fd.authorityType === 'Owner' && params.ownerWallet) {
    return assetOwnerAddress(params.asset) === params.ownerWallet.trim()
  }
  return false
}

/** Holder wallet can re-lock with updatePlugin (frozen: true) without RemovePlugin. */
export function mplCoreNestNeedsWalletRelock(params: {
  asset: unknown
  nestingDelegateAddress: string
  ownerWallet: string
}): boolean {
  if (isMplCoreNestingLockHeld(params)) return false
  const fd = readMplCoreFreezeDelegate(params.asset)
  if (!fd) return true
  if (fd.authorityType === 'Owner' && assetOwnerAddress(params.asset) === params.ownerWallet.trim()) {
    return true
  }
  return false
}

/** Server nesting authority may set frozen:true on an existing Address delegate without RemovePlugin. */
export function mplCoreNestCanServerRefreeze(params: {
  asset: unknown
  nestingDelegateAddress: string
}): boolean {
  const fd = readMplCoreFreezeDelegate(params.asset)
  if (!fd || fd.frozen) return false
  const delegate = params.nestingDelegateAddress.trim()
  return fd.authorityType === 'Address' && fd.authorityAddress === delegate
}
