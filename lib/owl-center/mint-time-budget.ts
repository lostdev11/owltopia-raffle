/** Hard ceiling for automated mint steps (prep + send + recovery). Wallet approval is separate. */
export const MINT_SESSION_MAX_MS = 30_000

export const MINT_PREP_MAX_MS = 8_000
export const MINT_SEND_MIN_MS = 6_000
export const MINT_RECOVERY_RESERVE_MS = 3_000
export const MINT_CONFIRM_BACKGROUND_MAX_MS = 12_000

export type MintSessionDeadline = {
  /** Unix ms — automated work must finish by this time. */
  endsAt: number
}

export function createMintSessionDeadline(maxMs = MINT_SESSION_MAX_MS): MintSessionDeadline {
  return { endsAt: Date.now() + maxMs }
}

export function mintSessionRemainingMs(deadline: MintSessionDeadline): number {
  return Math.max(0, deadline.endsAt - Date.now())
}

export function mintSessionTimedOut(deadline: MintSessionDeadline): boolean {
  return mintSessionRemainingMs(deadline) <= 0
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
