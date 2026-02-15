'use client'

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Percent } from 'lucide-react'
import type { RevShareAmounts } from '@/lib/raffle-profit'
import { cn } from '@/lib/utils'
import { useCallback, useState } from 'react'

interface RevShareBadgeProps {
  amounts: RevShareAmounts
  className?: string
}

function formatSol(n: number): string {
  return n.toFixed(4)
}
function formatUsdc(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function RevShareBadge({ amounts, className }: RevShareBadgeProps) {
  const [open, setOpen] = useState(false)

  const hasAny = amounts.founderSol > 0 || amounts.founderUsdc > 0 || amounts.communitySol > 0 || amounts.communityUsdc > 0
  const summaryParts: string[] = []
  if (amounts.founderSol > 0 || amounts.communitySol > 0) {
    const sol = amounts.founderSol + amounts.communitySol
    summaryParts.push(`${formatSol(sol)} SOL`)
  } else {
    summaryParts.push('0 SOL')
  }
  if (amounts.founderUsdc > 0 || amounts.communityUsdc > 0) {
    const usdc = amounts.founderUsdc + amounts.communityUsdc
    summaryParts.push(`${formatUsdc(usdc)} USDC`)
  } else {
    summaryParts.push('0.00 USDC')
  }
  const summary = summaryParts.join(' · ')

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen((prev) => !prev)
  }, [])

  const tooltipContent = (
    <div className="space-y-2 text-sm">
      <div className="font-semibold">Rev Share (50% founder / 50% community)</div>
      <div className="border-t border-border pt-2 space-y-1.5">
        <div>
          <span className="font-medium">Founder (50%):</span>{' '}
          <span className="tabular-nums">{formatSol(amounts.founderSol)} SOL</span>
          {', '}
          <span className="tabular-nums">{formatUsdc(amounts.founderUsdc)} USDC</span>
        </div>
        <div>
          <span className="font-medium">Community (50%):</span>{' '}
          <span className="tabular-nums">{formatSol(amounts.communitySol)} SOL</span>
          {', '}
          <span className="tabular-nums">{formatUsdc(amounts.communityUsdc)} USDC</span>
        </div>
      </div>
    </div>
  )

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <div className="inline-flex relative z-20">
            <Badge
              variant="outline"
              role="button"
              tabIndex={0}
              aria-label="Rev Share — amounts in SOL and USDC"
              className={cn(
                'cursor-help gap-1.5 select-none touch-manipulation',
                hasAny ? 'border-green-500/50 text-green-400' : 'text-muted-foreground border-border',
                className
              )}
              onClick={handleClick}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setOpen((prev) => !prev)
                }
              }}
            >
              <Percent className="h-3 w-3" />
              <span>Rev Share {summary}</span>
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs z-[100]"
          onPointerDownOutside={() => setOpen(false)}
        >
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
