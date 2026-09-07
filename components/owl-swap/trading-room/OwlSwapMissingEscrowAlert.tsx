'use client'

import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  simulateMode?: boolean
  className?: string
}

/** Loud blocking alert when escrow is unavailable (and not in simulation). */
export function OwlSwapMissingEscrowAlert({ simulateMode = false, className }: Props) {
  if (simulateMode) return null
  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-red-500/50 bg-red-500/15 px-3 py-3 text-sm text-red-50',
        className
      )}
    >
      <p className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden />
        OwlSwap escrow is not configured
      </p>
      <p className="mt-2 text-xs leading-relaxed text-red-100/90">
        <code className="text-[11px]">OWL_SWAP_ESCROW_SECRET_KEY</code> is missing, so{' '}
        <code className="text-[11px]">GET /api/owl-swap/escrow</code> returns 503 and Create /
        Accept stay disabled. Generate a dedicated key with{' '}
        <code className="text-[11px]">npm run generate:owl-swap-escrow-key</code>, set it on the
        host, fund the pubkey with a little SOL for ATA rent, and redeploy. Do not reuse prize or
        funds escrow keys.
      </p>
    </div>
  )
}
