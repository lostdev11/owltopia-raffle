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

interface OwlVisionBadgeProps {
  score: OwlVisionScore
  className?: string
}

export function OwlVisionBadge({ score, className }: OwlVisionBadgeProps) {
  const getScoreColor = (scoreValue: number) => {
    if (scoreValue >= 80) return 'text-green-400'
    if (scoreValue >= 60) return 'text-yellow-400'
    if (scoreValue >= 40) return 'text-orange-400'
    return 'text-red-400'
  }

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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              'cursor-help gap-1.5 border-current',
              getScoreColor(score.score),
              className
            )}
          >
            <Eye className="h-3 w-3" />
            <span>Owl Vision {score.score}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
