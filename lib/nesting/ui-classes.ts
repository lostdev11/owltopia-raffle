/** Muted styling for mock / cautious staking actions (not primary green). */
export const nestingMutedActionButtonClass =
  'min-h-[44px] touch-manipulation border border-border bg-muted/60 text-muted-foreground shadow-none hover:bg-muted/90 hover:text-foreground disabled:opacity-45'

/** Green claim CTA when ≥1 OWL is claimable on a nest or via Claim all. */
export const nestingClaimReadyButtonClass =
  'font-semibold shadow-[0_0_22px_rgba(0,255,136,0.22)]'

/** Gray claim CTA after payout until another 1 OWL accrues. */
export const nestingClaimAccruingButtonClass =
  'border border-border bg-muted/50 text-muted-foreground shadow-none hover:bg-muted/50 hover:text-muted-foreground cursor-not-allowed opacity-55'
