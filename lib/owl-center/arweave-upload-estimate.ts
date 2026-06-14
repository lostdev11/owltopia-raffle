import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import { estimateIrysFolderUploadLamports, isIrysUploadConfigured } from '@/lib/owl-center/irys-uploader'
import { lamportsToSolDisplay } from '@/lib/gen2-presale/format-sol'

export type ArweaveUploadEstimate = {
  /** Bytes that will be uploaded to Arweave (uncompressed file total when known). */
  total_bytes: number
  file_count: number
  /** Estimated cost before wallet buffer. */
  estimate_lamports: string
  estimate_sol: string
  /** Suggested wallet balance (+25% buffer for batch overhead). */
  fund_lamports: string
  fund_sol: string
  sol_usd_price: number | null
  source: 'irys_quote' | 'heuristic'
  note: string
}

function arweaveUsdPerGb(): number {
  const raw = process.env.OWL_CENTER_ARWEAVE_USD_PER_GB?.trim()
  const n = raw ? Number(raw) : 6
  return Number.isFinite(n) && n > 0 ? n : 6
}

function estimateBufferMultiplier(): number {
  return 1.25
}

export function uploadBytesFromJob(job: OwlCenterAssetUploadJob | null | undefined): {
  totalBytes: number
  fileCount: number
  source: 'validated' | 'zip' | 'file_list' | 'unknown'
} {
  if (!job) return { totalBytes: 0, fileCount: 0, source: 'unknown' }

  const progress = job.upload_progress as {
    total_upload_bytes?: number
    staged_zip_bytes?: number
  }
  const fileCount = job.upload_progress.file_list.length

  if (typeof progress.total_upload_bytes === 'number' && progress.total_upload_bytes > 0) {
    return { totalBytes: progress.total_upload_bytes, fileCount: fileCount || 1, source: 'validated' }
  }
  if (typeof progress.staged_zip_bytes === 'number' && progress.staged_zip_bytes > 0) {
    // ZIP is usually close to PNG total; JSON is tiny — slight headroom before validation.
    return {
      totalBytes: Math.ceil(progress.staged_zip_bytes * 1.05),
      fileCount: fileCount || 1,
      source: 'zip',
    }
  }
  if (fileCount > 0) {
    return { totalBytes: fileCount * 450_000, fileCount, source: 'file_list' }
  }
  return { totalBytes: 0, fileCount: 0, source: 'unknown' }
}

async function heuristicLamports(totalBytes: number, fileCount: number): Promise<{
  lamports: bigint
  solUsd: number
}> {
  const solUsd = await resolveGen2SolUsdPrice()
  const usd = (totalBytes / (1024 * 1024 * 1024)) * arweaveUsdPerGb()
  const perFileUsd = fileCount * 0.000_002
  const totalUsd = usd + perFileUsd
  const sol = totalUsd / solUsd
  const lamports = BigInt(Math.max(1, Math.round(sol * LAMPORTS_PER_SOL)))
  return { lamports, solUsd }
}

export async function buildArweaveUploadEstimate(
  job: OwlCenterAssetUploadJob | null | undefined
): Promise<ArweaveUploadEstimate | null> {
  const { totalBytes, fileCount, source: byteSource } = uploadBytesFromJob(job)
  if (totalBytes < 1) return null

  const count = Math.max(1, fileCount)

  if (isIrysUploadConfigured()) {
    const irys = await estimateIrysFolderUploadLamports(totalBytes, count)
    if (irys) {
      const fund = (irys.lamports * BigInt(Math.round(estimateBufferMultiplier() * 100))) / 100n
      return {
        total_bytes: totalBytes,
        file_count: count,
        estimate_lamports: irys.lamports.toString(),
        estimate_sol: lamportsToSolDisplay(irys.lamports),
        fund_lamports: fund.toString(),
        fund_sol: lamportsToSolDisplay(fund),
        sol_usd_price: irys.solUsdPrice,
        source: 'irys_quote',
        note:
          byteSource === 'validated'
            ? 'Live Irys quote from validated file sizes.'
            : 'Live Irys quote from staged ZIP size (re-run validation for a tighter estimate).',
      }
    }
  }

  const { lamports, solUsd } = await heuristicLamports(totalBytes, count)
  const fund = (lamports * BigInt(Math.round(estimateBufferMultiplier() * 100))) / 100n

  return {
    total_bytes: totalBytes,
    file_count: count,
    estimate_lamports: lamports.toString(),
    estimate_sol: lamportsToSolDisplay(lamports),
    fund_lamports: fund.toString(),
    fund_sol: lamportsToSolDisplay(fund),
    sol_usd_price: solUsd,
    source: 'heuristic',
    note:
      byteSource === 'validated'
        ? 'Heuristic from validated bytes (set IRYS_PRIVATE_KEY for a live Irys quote).'
        : 'Heuristic from staged ZIP — validate for a tighter number.',
  }
}

export function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatArweaveUploadEstimateLine(estimate: ArweaveUploadEstimate): string {
  return `~${estimate.estimate_sol} SOL upload (${formatBytesShort(estimate.total_bytes)}, ${estimate.file_count} files) · fund wallet with ~${estimate.fund_sol} SOL`
}
