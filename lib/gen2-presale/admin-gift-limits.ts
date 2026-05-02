/**
 * Admin Gen2 presale gifting — caps and env override (server-side enforcement in gift API).
 * UI clamps to ABSOLUTE_CAP; API uses DEFAULT unless GEN2_PRESALE_ADMIN_MAX_GIFT_QTY is set.
 */
export const GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_DEFAULT = 50

/** Hard ceiling for env override and admin UI input clamping. */
export const GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_ABSOLUTE_CAP = 200

/** Postgres RPC refuses above this (defense in depth). */
export const GEN2_PRESALE_GIFT_SQL_HARD_CAP = 500

export function getGen2PresaleAdminMaxGiftQuantity(): number {
  const raw = process.env.GEN2_PRESALE_ADMIN_MAX_GIFT_QTY?.trim()
  if (!raw) return GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_DEFAULT
  return Math.min(GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_ABSOLUTE_CAP, Math.floor(n))
}
