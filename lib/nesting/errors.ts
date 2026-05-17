/** Thrown internally during staking flows — carries UI copy without relying on `{ message: 'stake' }` alone. */
export class NestingStakeFlowError extends Error {
  readonly userMessage: string
  constructor(userMessage: string) {
    super('nesting-stake-flow')
    this.name = 'NestingStakeFlowError'
    this.userMessage = userMessage
  }
}

export function isNestingStakeFlowError(e: unknown): e is NestingStakeFlowError {
  return e instanceof NestingStakeFlowError
}

/** Domain error mapped to HTTP by `/api/me/staking/*` routes. */
export class StakingUserError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly extra?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'StakingUserError'
  }
}

export function isStakingUserError(e: unknown): e is StakingUserError {
  return e instanceof StakingUserError
}
