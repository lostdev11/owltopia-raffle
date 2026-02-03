'use client'

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Eye } from 'lucide-react'
import type { OwlVisionScore } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useCallback, useState } from 'react'

interface OwlVisionBadgeProps {
  score: OwlVisionScore
  className?: string
  /** When provided (e.g. on detail page), clicking opens this tab instead of toggling tooltip */
  onOpenInTab?: () => void
}

export function OwlVisionBadge({ score, className, onOpenInTab }: OwlVisionBadgeProps) {
  const [open, setOpen] = useState(false)

  const getScoreColor = (scoreValue: number) => {
    if (scoreValue >= 80) return 'text-green-400'
    if (scoreValue >= 60) return 'text-blue-400'
    if (scoreValue >= 40) return 'text-orange-400'
    return 'text-red-400'
  }

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onOpenInTab) {
      onOpenInTab()
    } else {
      setOpen((prev) => !prev)
    }
  }, [onOpenInTab])

  const handlePointerEnter = useCallback(() => setOpen(true), [])
  // Don't close on trigger leave — let Radix close when pointer leaves both trigger and content (hoverable content)

  const tooltipContent = (
    <div className="space-y-2 text-sm">
      <div className="font-semibold">Owl Vision Trust Score: {score.score}/100</div>
      <div className="border-t border-border pt-2 space-y-1">
        <div>
          <span className="font-medium">Verified Payments:</span>{' '}
          {Math.round(score.verifiedRatio * 100)}% ({score.confirmedEntries}/{score.totalEntries} entries)
        </div>
        <div>
          <span className="font-medium">Wallet Diversity:</span>{' '}
          {Math.round(score.diversityRatio * 100)}% ({score.uniqueWallets} unique wallets)
        </div>
        <div>
          <span className="font-medium">Time Integrity:</span>{' '}
          {score.integrityScore}/10 {score.editedAfterEntries ? '(Edited after entries)' : '(Not edited)'}
        </div>
      </div>
    </div>
  )

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <div
            className="inline-flex relative z-20"
            onPointerEnter={handlePointerEnter}
          >
            <Badge
              variant="outline"
              role="button"
              tabIndex={0}
              aria-label="Owl Vision trust score — click or hover for breakdown"
              className={cn(
                'cursor-help gap-1.5 border-current select-none touch-manipulation',
                getScoreColor(score.score),
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
              <Eye className="h-3 w-3" />
              <span>Owl Vision {score.score}</span>
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
