import {
  OWL_SEND_ATA_RENT_SOL,
  OWL_SEND_NETWORK_FEE_SOL_PER_APPROVAL,
} from '@/lib/owl-send/constants'
import { formatOwlSendFeeSol, getOwlSendFeeSol, getOwlSendFeeSolForDiscount } from '@/lib/owl-send/fee'
import { clampOwlSendDiscountBps } from '@/lib/owl-send/holder-discount'

export type OwlSendCostEstimate = {
  nftCount: number
  batchCount: number
  feePerNftSol: number
  /** Base (undiscounted) per-line fee. */
  baseFeePerNftSol: number
  discountBps: number
  discountPercent: number
  platformFeeSol: number
  /** Estimated rent if every line needs a new ATA (upper bound when unknown). */
  rentSolMax: number
  /** Rent for known new-ATA count. */
  rentSolKnown: number | null
  newAtaCountKnown: number | null
  networkFeeSol: number
  totalSolKnown: number | null
  totalSolMax: number
  feeLabel: string
  rentLabel: string
  networkLabel: string
  totalLabel: string
  perNftFeeLabel: string
}

export function buildOwlSendCostEstimate(params: {
  nftCount: number
  batchCount: number
  /** When known from preflight; null = show max (assume all need ATA). */
  newAtaCount?: number | null
  /** Owltopia holder discount in basis points (0–10000). */
  discountBps?: number
}): OwlSendCostEstimate | null {
  const nftCount = Math.max(0, Math.floor(params.nftCount))
  if (nftCount < 1) return null
  const batchCount = Math.max(1, Math.floor(params.batchCount))
  const discountBps = clampOwlSendDiscountBps(params.discountBps ?? 0)
  const baseFeePerNftSol = getOwlSendFeeSol()
  const feePerNftSol = getOwlSendFeeSolForDiscount(discountBps)
  const platformFeeSol = feePerNftSol * nftCount
  const rentSolMax = OWL_SEND_ATA_RENT_SOL * nftCount
  const newAtaCountKnown =
    typeof params.newAtaCount === 'number' && Number.isFinite(params.newAtaCount)
      ? Math.max(0, Math.floor(params.newAtaCount))
      : null
  const rentSolKnown =
    newAtaCountKnown != null ? OWL_SEND_ATA_RENT_SOL * newAtaCountKnown : null
  const networkFeeSol = OWL_SEND_NETWORK_FEE_SOL_PER_APPROVAL * batchCount
  const totalSolMax = platformFeeSol + rentSolMax + networkFeeSol
  const totalSolKnown =
    rentSolKnown != null ? platformFeeSol + rentSolKnown + networkFeeSol : null

  const rentLabel =
    rentSolKnown != null
      ? rentSolKnown <= 0
        ? 'No new token accounts (rent $0)'
        : `${formatOwlSendFeeSol(rentSolKnown)} Solana rent (${newAtaCountKnown} new account${newAtaCountKnown === 1 ? '' : 's'})`
      : `Up to ${formatOwlSendFeeSol(rentSolMax)} Solana rent if recipients need new accounts`

  const totalLabel =
    totalSolKnown != null
      ? `~${formatOwlSendFeeSol(totalSolKnown)}`
      : `~${formatOwlSendFeeSol(platformFeeSol + networkFeeSol)} + rent if needed`

  const discountNote =
    discountBps > 0 ? ` · ${discountBps / 100}% holder discount` : ''

  return {
    nftCount,
    batchCount,
    feePerNftSol,
    baseFeePerNftSol,
    discountBps,
    discountPercent: discountBps / 100,
    platformFeeSol,
    rentSolMax,
    rentSolKnown,
    newAtaCountKnown,
    networkFeeSol,
    totalSolKnown,
    totalSolMax,
    feeLabel: `${formatOwlSendFeeSol(platformFeeSol)} Owl fee (${nftCount} × ${formatOwlSendFeeSol(feePerNftSol)})${discountNote}`,
    rentLabel,
    networkLabel: `~${formatOwlSendFeeSol(networkFeeSol)} network`,
    totalLabel,
    perNftFeeLabel: formatOwlSendFeeSol(feePerNftSol),
  }
}

export function buildBatchCostEstimate(params: {
  nftCountInBatch: number
  newAtaCount?: number | null
  discountBps?: number
}): OwlSendCostEstimate | null {
  return buildOwlSendCostEstimate({
    nftCount: params.nftCountInBatch,
    batchCount: 1,
    newAtaCount: params.newAtaCount,
    discountBps: params.discountBps,
  })
}
