export type Gen2PresaleStats = {
  presale_supply: number
  sold: number
  remaining: number
  percent_sold: number
  unit_price_usdc: number
  unit_lamports: string | null
  sol_usd_price: number | null
  /** False until admin turns presale on (DB `gen2_presale_settings.is_live`). */
  presale_live: boolean
}

export type Gen2PresaleBalance = {
  wallet: string
  purchased_mints: number
  gifted_mints: number
  used_mints: number
  available_mints: number
}
