export type ThemeAccent = 'prime' | 'midnight' | 'dawn'

export type EntryStatus = 'pending' | 'confirmed' | 'rejected'

export type PrizeType = 'crypto' | 'nft'

export type RaffleStatus = 'draft' | 'live' | 'ready_to_draw' | 'completed' | null

/** Supported raffle ticket currencies */
export type RaffleCurrency = 'SOL' | 'USDC' | 'OWL'

export interface Raffle {
  id: string
  slug: string
  title: string
  description: string | null
  image_url: string | null
  prize_type: PrizeType
  prize_amount: number | null
  prize_currency: string | null
  nft_mint_address: string | null
  nft_collection_name: string | null
  nft_token_id: string | null
  nft_metadata_uri: string | null
  ticket_price: number
  currency: RaffleCurrency
  max_tickets: number | null
  min_tickets: number | null
  start_time: string
  end_time: string
  original_end_time: string | null
  theme_accent: ThemeAccent
  edited_after_entries: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  is_active: boolean
  winner_wallet: string | null
  winner_selected_at: string | null
  status: RaffleStatus
  nft_transfer_transaction: string | null
  rank: string | null
  floor_price: string | null
}

export interface Entry {
  id: string
  raffle_id: string
  wallet_address: string
  ticket_quantity: number
  transaction_signature: string | null
  status: EntryStatus
  amount_paid: number
  currency: RaffleCurrency
  created_at: string
  verified_at: string | null
  restored_at: string | null
  restored_by: string | null
}

export interface OwlVisionScore {
  score: number
  verifiedRatio: number
  diversityRatio: number
  integrityScore: number
  totalEntries: number
  confirmedEntries: number
  uniqueWallets: number
  editedAfterEntries: boolean
}

export interface RaffleWithStats extends Raffle {
  total_entries: number
  confirmed_entries: number
  unique_wallets: number
  owl_vision_score: number
}
