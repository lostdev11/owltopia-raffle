import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/** Metaplex default — 5% secondary royalty. */
export const DEFAULT_SELLER_FEE_BASIS_POINTS = 500

export const MAX_SELLER_FEE_BASIS_POINTS = 10_000

export function basisPointsToPercent(bps: number): number {
  return bps / 100
}

export function percentToBasisPoints(percent: number): number {
  return Math.round(percent * 100)
}

export function formatRoyaltyPercentLabel(bps: number): string {
  const pct = basisPointsToPercent(bps)
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`
}

/** Royalty locks once a Candy Machine is deployed — on-chain rate is fixed for that CM. */
export function isLaunchRoyaltyLocked(
  launch: Pick<OwlCenterLaunchPublic, 'candy_machine_id' | 'devnet_candy_machine_id'>
): boolean {
  return Boolean(launch.candy_machine_id?.trim() || launch.devnet_candy_machine_id?.trim())
}

export function normalizeSellerFeeBasisPoints(raw: unknown, fallback = DEFAULT_SELLER_FEE_BASIS_POINTS): number {
  if (raw == null || raw === '') return fallback
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_SELLER_FEE_BASIS_POINTS, Math.max(0, n))
}

/** Parse creator-facing percent (0–100) or raw basis points from API bodies. */
export function parseRoyaltyFromBody(body: Record<string, unknown>): number {
  if (body.seller_fee_basis_points != null && body.seller_fee_basis_points !== '') {
    return normalizeSellerFeeBasisPoints(body.seller_fee_basis_points)
  }
  if (body.royalty_percent != null && body.royalty_percent !== '') {
    const pct = Number(body.royalty_percent)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return normalizeSellerFeeBasisPoints(NaN, DEFAULT_SELLER_FEE_BASIS_POINTS)
    }
    return percentToBasisPoints(pct)
  }
  return DEFAULT_SELLER_FEE_BASIS_POINTS
}

export function launchSellerFeeBasisPoints(launch: Pick<OwlCenterLaunchPublic, 'seller_fee_basis_points'>): number {
  return normalizeSellerFeeBasisPoints(launch.seller_fee_basis_points ?? DEFAULT_SELLER_FEE_BASIS_POINTS)
}
