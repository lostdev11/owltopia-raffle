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
  /** True when all presale spots are sold (not set when `sold_sync_unavailable`). */
  presale_sold_out: boolean
  /** True when admin has presale live and supply remains — use to gate the buy UI. */
  purchases_open: boolean
  /**
   * When true, `sold` / `remaining` / `percent_sold` are placeholders — Supabase was unreachable.
   * Server oversell protection still applies on checkout once DB is back.
   */
  sold_sync_unavailable?: boolean
}

export type Gen2PresaleBalance = {
  wallet: string
  purchased_mints: number
  gifted_mints: number
  used_mints: number
  available_mints: number
}
