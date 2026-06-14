'use client'

import type { ArweaveUploadEstimate } from '@/lib/owl-center/arweave-upload-estimate'
import { formatArweaveUploadEstimateLine, formatBytesShort } from '@/lib/owl-center/arweave-upload-estimate'

export function ArweaveUploadEstimateBanner({
  estimate,
  irysConfigured,
}: {
  estimate: ArweaveUploadEstimate | null
  irysConfigured: boolean
}) {
  if (!estimate) return null

  return (
    <div className="mb-4 rounded border border-[#5C6773]/40 bg-[#0F1419]/90 px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#9BA8B4]">Estimated Arweave cost</p>
      <p className="mt-2 font-mono text-sm text-[#E8FDF4]">{formatArweaveUploadEstimateLine(estimate)}</p>
      <p className="mt-2 text-xs leading-relaxed text-[#9BA8B4]">
        {formatBytesShort(estimate.total_bytes)} across {estimate.file_count} file(s)
        {estimate.sol_usd_price != null ? ` · SOL ≈ $${estimate.sol_usd_price.toFixed(2)}` : ''}
        {estimate.source === 'irys_quote' ? ' · live Irys quote' : ' · heuristic (validate + IRYS_PRIVATE_KEY for live quote)'}
      </p>
      {!irysConfigured ? (
        <p className="mt-2 text-xs text-[#FFD769]">
          Set <code className="text-[#E8D089]">IRYS_PRIVATE_KEY</code> to a wallet funded with at least ~{estimate.fund_sol}{' '}
          SOL before Push to Arweave.
        </p>
      ) : (
        <p className="mt-2 text-xs text-[#9BA8B4]">
          Fund the Irys payer wallet with ~{estimate.fund_sol} SOL (+ buffer) before Push to Arweave. Upload once — skip{' '}
          <code className="text-[#7D8A93]">sugar upload</code> if using this path.
        </p>
      )}
      <p className="mt-1 text-[10px] text-[#5C6773]">{estimate.note}</p>
    </div>
  )
}
