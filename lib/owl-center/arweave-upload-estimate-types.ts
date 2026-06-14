/** Client-safe Arweave upload estimate shape (computed on server). */
export type ArweaveUploadEstimate = {
  total_bytes: number
  file_count: number
  estimate_lamports: string
  estimate_sol: string
  fund_lamports: string
  fund_sol: string
  sol_usd_price: number | null
  source: 'irys_quote' | 'heuristic'
  note: string
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
