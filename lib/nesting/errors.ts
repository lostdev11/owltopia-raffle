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
