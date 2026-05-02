import type { Gen2PresaleBalance, Gen2PresaleStats } from '@/lib/gen2-presale/types'

const PCT_EPS = 1e-4

function expectRemaining(presale_supply: number, sold: number): number {
  return Math.max(0, Math.floor(presale_supply) - Math.floor(sold))
}

/**
 * Detect inconsistent or unusable presale stats before users attempt checkout.
 * Safe to run on public API payloads (no secrets).
 */
export function getGen2PresaleStatsIssues(stats: Gen2PresaleStats): string[] {
  const issues: string[] = []
  const {
    presale_supply,
    sold,
    remaining,
    percent_sold,
    unit_price_usdc,
    unit_lamports,
    sol_usd_price,
    presale_live,
  } = stats

  if (!Number.isFinite(presale_supply) || presale_supply <= 0) {
    issues.push('Presale supply is missing or invalid.')
  }

  if (!Number.isFinite(sold) || sold < 0) {
    issues.push('Sold count is invalid.')
  }

  if (Number.isFinite(presale_supply) && Number.isFinite(sold) && presale_supply > 0 && sold > presale_supply) {
    issues.push('Recorded sales exceed total supply — verification needed.')
  }

  if (
    Number.isFinite(presale_supply) &&
    Number.isFinite(sold) &&
    Number.isFinite(remaining) &&
    presale_supply >= 0 &&
    sold >= 0
  ) {
    const expectedRem = expectRemaining(presale_supply, sold)
    if (remaining !== expectedRem) {
      issues.push('Remaining spots do not match sold vs supply.')
    }
  }

  if (Number.isFinite(presale_supply) && presale_supply > 0 && Number.isFinite(percent_sold) && Number.isFinite(sold)) {
    const expectedPct = (sold / presale_supply) * 100
    if (Math.abs(percent_sold - expectedPct) > PCT_EPS) {
      issues.push('Progress percentage does not match sold amount.')
    }
  }

  if (!Number.isFinite(unit_price_usdc) || unit_price_usdc <= 0) {
    issues.push('Spot price (USDC) is invalid.')
  }

  if (presale_live && (unit_lamports == null || unit_lamports === '')) {
    issues.push('SOL quote unavailable — refresh the page or try again on Wi‑Fi before purchasing.')
  }

  if (unit_lamports != null && unit_lamports !== '') {
    try {
      const v = BigInt(unit_lamports)
      if (v <= 0n) issues.push('SOL amount per spot is invalid.')
    } catch {
      issues.push('SOL quote could not be read.')
    }
  }

  if (sol_usd_price != null && (!Number.isFinite(sol_usd_price) || sol_usd_price <= 0)) {
    issues.push('SOL/USD rate looks invalid.')
  }

  return issues
}

/** Wallet balance row sanity (view should always satisfy this). */
export function getGen2PresaleBalanceIssues(b: Gen2PresaleBalance): string[] {
  const issues: string[] = []
  const { purchased_mints, gifted_mints, used_mints, available_mints } = b

  if (!Number.isFinite(purchased_mints) || purchased_mints < 0 || !Number.isInteger(purchased_mints)) {
    issues.push('Purchased mint total is invalid.')
  }
  if (!Number.isFinite(gifted_mints) || gifted_mints < 0 || !Number.isInteger(gifted_mints)) {
    issues.push('Gifted mint total is invalid.')
  }
  if (!Number.isFinite(used_mints) || used_mints < 0 || !Number.isInteger(used_mints)) {
    issues.push('Used mint total is invalid.')
  }
  if (!Number.isFinite(available_mints) || available_mints < 0 || !Number.isInteger(available_mints)) {
    issues.push('Available mint balance is invalid.')
  }

  if (
    Number.isFinite(purchased_mints) &&
    Number.isFinite(gifted_mints) &&
    Number.isFinite(used_mints) &&
    Number.isFinite(available_mints)
  ) {
    const expected = purchased_mints + gifted_mints - used_mints
    if (available_mints !== expected) {
      issues.push('Available mints do not match your purchase and usage totals.')
    }
  }

  return issues
}
