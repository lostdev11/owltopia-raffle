/** Server-side: payment verify or RPC quota — client may retry the same open + payment sig. */
export class PackOpenRetryableError extends Error {
  readonly retryable = true

  constructor(message: string) {
    super(message)
    this.name = 'PackOpenRetryableError'
  }
}

export function isPackOpenRetryableError(error: unknown): error is PackOpenRetryableError {
  return error instanceof PackOpenRetryableError
}
