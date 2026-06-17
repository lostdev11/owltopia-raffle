/** Automated mint work (prep + on-chain send/confirm) after the user taps Mint. Wallet approval is paused out of this budget. */
export const MINT_SESSION_MAX_MS = 15_000

/** Absolute safety ceiling for the full tap-to-finish flow (includes slow wallet approval on mobile). */
export const MINT_SESSION_OUTER_MAX_MS = 60_000

export const MINT_PREP_MAX_MS = 5_000
export const MINT_SEND_MIN_MS = 5_000
export const MINT_RECOVERY_RESERVE_MS = 2_000
export const MINT_CONFIRM_BACKGROUND_MAX_MS = 10_000

export type MintSessionDeadline = {
  /** Unix ms — automated work must finish by this time (unless wallet-paused). */
  endsAt: number
  /** Frozen remaining budget while Phantom / Solflare shows the approval sheet. */
  walletPausedRemaining?: number
}

export function createMintSessionDeadline(maxMs = MINT_SESSION_MAX_MS): MintSessionDeadline {
  return { endsAt: Date.now() + maxMs }
}

export function mintSessionRemainingMs(deadline: MintSessionDeadline): number {
  if (deadline.walletPausedRemaining != null) {
    return deadline.walletPausedRemaining
  }
  return Math.max(0, deadline.endsAt - Date.now())
}

export function mintSessionTimedOut(deadline: MintSessionDeadline): boolean {
  return mintSessionRemainingMs(deadline) <= 0
}

/** Freeze the automated budget while the user reviews the wallet approval sheet. */
export function pauseMintSessionDeadline(deadline: MintSessionDeadline): void {
  if (deadline.walletPausedRemaining != null) return
  deadline.walletPausedRemaining = mintSessionRemainingMs(deadline)
}

/** Resume the automated budget after wallet approval returns. */
export function resumeMintSessionDeadline(deadline: MintSessionDeadline): void {
  if (deadline.walletPausedRemaining == null) return
  const remaining = deadline.walletPausedRemaining
  deadline.walletPausedRemaining = undefined
  deadline.endsAt = Date.now() + remaining
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MintSessionTimeoutError extends Error {
  constructor(message = 'Mint is taking too long — check your wallet Collectibles or tap Mint again.') {
    super(message)
    this.name = 'MintSessionTimeoutError'
  }
}

/** Reject when the mint session budget is exhausted. */
export async function withMintSessionBudget<T>(
  deadline: MintSessionDeadline,
  fn: () => Promise<T>,
  timeoutMessage?: string
): Promise<T> {
  if (deadline.walletPausedRemaining != null) {
    return fn()
  }
  const remaining = mintSessionRemainingMs(deadline)
  if (remaining <= 0) {
    throw new MintSessionTimeoutError(timeoutMessage)
  }
  return Promise.race([
    fn(),
    sleepMs(remaining).then(() => {
      throw new MintSessionTimeoutError(timeoutMessage)
    }),
  ])
}

/** Race an existing promise against the remaining session budget. */
export async function raceMintSessionBudget<T>(
  deadline: MintSessionDeadline,
  promise: Promise<T>,
  timeoutMessage?: string
): Promise<T> {
  return withMintSessionBudget(deadline, () => promise, timeoutMessage)
}
