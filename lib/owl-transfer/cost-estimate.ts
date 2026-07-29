import {
  OWL_TRANSFER_ATA_RENT_SOL,
  OWL_TRANSFER_NETWORK_FEE_SOL_PER_APPROVAL,
} from '@/lib/owl-transfer/constants'
import { formatOwlTransferFeeSol, getOwlTransferFeeSol } from '@/lib/owl-transfer/fee'

export type OwlTransferCostEstimate = {
  nftCount: number
  batchCount: number
  feePerNftSol: number
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

export function buildOwlTransferCostEstimate(params: {
  nftCount: number
  batchCount: number
  /** When known from preflight; null = show max (assume all need ATA). */
  newAtaCount?: number | null
}): OwlTransferCostEstimate | null {
  const nftCount = Math.max(0, Math.floor(params.nftCount))
  if (nftCount < 1) return null
  const batchCount = Math.max(1, Math.floor(params.batchCount))
  const feePerNftSol = getOwlTransferFeeSol()
  const platformFeeSol = feePerNftSol * nftCount
  const rentSolMax = OWL_TRANSFER_ATA_RENT_SOL * nftCount
  const newAtaCountKnown =
    typeof params.newAtaCount === 'number' && Number.isFinite(params.newAtaCount)
      ? Math.max(0, Math.floor(params.newAtaCount))
      : null
  const rentSolKnown =
    newAtaCountKnown != null ? OWL_TRANSFER_ATA_RENT_SOL * newAtaCountKnown : null
  const networkFeeSol = OWL_TRANSFER_NETWORK_FEE_SOL_PER_APPROVAL * batchCount
  const totalSolMax = platformFeeSol + rentSolMax + networkFeeSol
  const totalSolKnown =
    rentSolKnown != null ? platformFeeSol + rentSolKnown + networkFeeSol : null

  const rentLabel =
    rentSolKnown != null
      ? rentSolKnown <= 0
        ? 'No new token accounts (rent $0)'
        : `${formatOwlTransferFeeSol(rentSolKnown)} Solana rent (${newAtaCountKnown} new account${newAtaCountKnown === 1 ? '' : 's'})`
      : `Up to ${formatOwlTransferFeeSol(rentSolMax)} Solana rent if recipients need new accounts`

  const totalLabel =
    totalSolKnown != null
      ? `~${formatOwlTransferFeeSol(totalSolKnown)}`
      : `~${formatOwlTransferFeeSol(platformFeeSol + networkFeeSol)} + rent if needed`

  return {
    nftCount,
    batchCount,
    feePerNftSol,
    platformFeeSol,
    rentSolMax,
    rentSolKnown,
    newAtaCountKnown,
    networkFeeSol,
    totalSolKnown,
    totalSolMax,
    feeLabel: `${formatOwlTransferFeeSol(platformFeeSol)} Owl fee (${nftCount} × ${formatOwlTransferFeeSol(feePerNftSol)})`,
    rentLabel,
    networkLabel: `~${formatOwlTransferFeeSol(networkFeeSol)} network`,
    totalLabel,
    perNftFeeLabel: formatOwlTransferFeeSol(feePerNftSol),
  }
}

export function buildBatchCostEstimate(params: {
  nftCountInBatch: number
  newAtaCount?: number | null
}): OwlTransferCostEstimate | null {
  return buildOwlTransferCostEstimate({
    nftCount: params.nftCountInBatch,
    batchCount: 1,
    newAtaCount: params.newAtaCount,
  })
}
