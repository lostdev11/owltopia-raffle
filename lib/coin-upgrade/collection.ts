/** Shared Owltopia Coins collection constants for art-upgrade Option A. */

export const OWLTOPIA_COIN_COLLECTION_ADDRESS =
  'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB'

/** On-chain collection update authority (Gembird). Signs the one-time UpdateDelegate authorize. */
export const OWLTOPIA_COIN_COLLECTION_UPDATE_AUTHORITY =
  '7PRb92msjUQTPmXnn79Lyt3UetUvmZFuwya4ZaVZ7ygS'

export function resolveOwltopiaCoinCollectionAddress(): string {
  return (
    process.env.NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS?.trim() ||
    process.env.OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
    OWLTOPIA_COIN_COLLECTION_ADDRESS
  )
}
