'use client'

import { cn } from '@/lib/utils'
import type { OwlSwapTxUiState } from '@/lib/owl-swap/trading-room-ui-state'
import { tradingRoomStatusBannerCopy } from '@/lib/owl-swap/trading-room-ui-state'

type Props = {
  state: OwlSwapTxUiState
  errorDetail?: string | null
  className?: string
}

export function OwlSwapTxStatusBanner({ state, errorDetail, className }: Props) {
  const copy = tradingRoomStatusBannerCopy(state)
  const detail = errorDetail?.trim() || copy.detail

  const toneClass =
    copy.tone === 'success'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-50'
      : copy.tone === 'error'
        ? 'border-red-500/40 bg-red-500/10 text-red-100'
        : copy.tone === 'warn'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-50'
          : copy.tone === 'progress'
            ? 'border-sky-500/40 bg-sky-500/10 text-sky-50'
            : 'border-white/15 bg-white/5 text-muted-foreground'

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('rounded-lg border px-3 py-2.5 text-sm', toneClass, className)}
    >
      <p className="font-medium">{copy.title}</p>
      {detail ? <p className="mt-0.5 text-xs opacity-90">{detail}</p> : null}
    </div>
  )
}
