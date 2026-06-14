'use client'

import { CheckCircle2, ExternalLink } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'

export type MintSuccessOverlayProps = {
  open: boolean
  /** How many NFTs were minted in this session. */
  quantity: number
  transactionSignature: string
  explorerUrl: string
  onClose: () => void
}

export function MintSuccessOverlay({
  open,
  quantity,
  transactionSignature,
  explorerUrl,
  onClose,
}: MintSuccessOverlayProps) {
  if (!open) return null

  const n = Math.max(1, quantity)
  const heading = n === 1 ? 'Mint successful!' : `${n} mints successful!`

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-[#0B0F14]/90 p-4 backdrop-blur-sm sm:items-center safe-area-bottom"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mint-success-overlay-title"
    >
      <div className="w-full max-w-md space-y-4 border border-[#1A222B] bg-[#0F1419] p-6 shadow-[0_0_40px_rgba(0,255,156,0.12)] sm:text-center">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#00FF9C]/15 text-[#00FF9C]"
          aria-hidden
        >
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 id="mint-success-overlay-title" className="text-lg font-semibold text-[#E8EEF2]">
          {heading}
        </h2>
        <p className="text-sm leading-relaxed text-[#9BA8B4]">
          Your NFT{n === 1 ? '' : 's'} {n === 1 ? 'is' : 'are'} now in your connected wallet. Open Phantom or Solflare
          and check Collectibles — it usually appears within a few seconds. If you don&apos;t see it yet, pull to refresh
          in your wallet app.
        </p>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 border border-[#1A222B] bg-[#0B0F14] px-4 font-mono text-xs uppercase tracking-widest text-[#00FF9C] hover:border-[#00FF9C]/40"
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          View transaction
        </a>
        <p className="font-mono text-[10px] text-[#5C6773] break-all" title={transactionSignature}>
          {transactionSignature.slice(0, 8)}…{transactionSignature.slice(-8)}
        </p>
        <DeployButton className="w-full" onClick={onClose}>
          Done
        </DeployButton>
      </div>
    </div>
  )
}
