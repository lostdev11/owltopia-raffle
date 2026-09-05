export type OwlSwapOfferStatus =
  | 'draft'
  | 'open'
  | 'completed'
  | 'cancelled'
  | 'expired'

export type OwlSwapAssetSide = 'maker' | 'taker'

export type OwlSwapAssetKind = 'spl_nft' | 'pnft' | 'cnft' | 'core' | 'spl_token'

export type OwlSwapMintInput = {
  mint: string
  name?: string | null
  imageUrl?: string | null
  collection?: string | null
  tokenAccount?: string | null
}
