/**
 * Collection used to recognize "Owl Nest" NFTs in wallet for nesting UI and policy.
 * Pool row `collection_key` overrides when set (admin-configured per perch).
 */
export function resolveWalletOwlNestCollectionAddress(): string {
  return (
    process.env.NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS?.trim() ||
    process.env.OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
    ''
  )
}
