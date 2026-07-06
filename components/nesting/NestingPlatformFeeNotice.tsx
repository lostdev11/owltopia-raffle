'use client'

import {
  formatStakingPlatformFeePerNestLabel,
  isStakingPlatformFeeEnabledClient,
} from '@/lib/nesting/staking-platform-fee'

type Props = {
  className?: string
  /** When true, mentions stake, claim, and leave (default). */
  includeActions?: boolean
  /** Stake flow: fee is bundled with the nest-lock wallet approval. */
  stakeBundled?: boolean
}

/**
 * Shared copy for the per-nest SOL platform fee (stake, claim, unstake).
 * Shown on perch cards and the nesting dashboard when env + treasury are configured.
 */
export function NestingPlatformFeeNotice({ className, includeActions = true, stakeBundled = false }: Props) {
  if (!isStakingPlatformFeeEnabledClient()) return null
  const unit = formatStakingPlatformFeePerNestLabel()
  if (stakeBundled) {
    return (
      <p className={className ?? 'text-xs text-muted-foreground leading-relaxed'}>
        Staking: <span className="font-medium text-foreground/90">{unit}</span> is included in the same wallet
        approval as your nest lock (not a separate charge).
      </p>
    )
  }
  const actions = includeActions ? ' (stake, claim OWL, and leave nest)' : ''
  return (
    <p className={className ?? 'text-xs text-muted-foreground leading-relaxed'}>
      Platform fee: <span className="font-medium text-foreground/90">{unit}</span>
      {actions}.
    </p>
  )
}

export function nestingPlatformFeeDescriptionSuffix(): string {
  if (!isStakingPlatformFeeEnabledClient()) return ''
  const unit = formatStakingPlatformFeePerNestLabel()
  return ` Platform fee: ${unit} each time you stake, claim OWL, or leave a nest.`
}
