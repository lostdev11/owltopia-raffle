'use client'

import { CheckCircle2, ExternalLink } from 'lucide-react'
import { OwlSendSolscanTxUrl } from '@/lib/owl-send/explorer'

type Props = {
  title: string
  signature: string
  detail?: string
}

export function OwlSendSuccessBanner({ title, signature, detail }: Props) {
  const href = OwlSendSolscanTxUrl(signature)
  return (
    <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-100">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold text-emerald-200">{title}</p>
        {detail ? <p className="text-xs text-emerald-100/80">{detail}</p> : null}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-theme-prime underline-offset-2 hover:underline"
        >
          View on Solscan
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        <p className="break-all font-mono text-[10px] text-emerald-100/60">{signature}</p>
      </div>
    </div>
  )
}
