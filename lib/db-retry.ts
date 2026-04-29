/**
 * Database retry utility for handling transient connection failures.
 * Useful during Supabase maintenance windows or brief network issues.
 */

interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  onRetry?: (error: Error, attempt: number) => void
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  onRetry: (error, attempt) => {
    console.warn(`Database operation failed (attempt ${attempt}), retrying...`, error.message)
  },
}

/**
 * Executes a database operation with automatic retry on transient failures.
 * Uses exponential backoff to avoid overwhelming the database during recovery.
 * 
 * @param operation - Async function to execute (database query/mutation)
 * @param options - Retry configuration options
 * @returns Result of the operation
 * @throws Error if all retries are exhausted
 * 
 * @example
 * ```typescript
 * const raffle = await withRetry(
 *   () => getRaffleById(id),
 *   { maxRetries: 3 }
 * )
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: Error | null = null
  let delay = opts.initialDelayMs

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // Don't retry on the last attempt
      if (attempt > opts.maxRetries) {
        break
      }

      // Check if error is retryable (connection/timeout errors)
      if (!isRetryableError(lastError)) {
        // Non-retryable error (e.g., validation error), throw immediately
        throw lastError
      }

      // Call retry callback
      opts.onRetry(lastError, attempt)

      // Wait before retrying with exponential backoff
      await sleep(delay)
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs)
    }
  }

  // All retries exhausted
  throw new Error(
    `Database operation failed after ${opts.maxRetries + 1} attempts: ${lastError?.message}`
  )
}

/**
 * Schema/client errors: wrong columns, 4xx from PostgREST/REST, invalid query — not fixed by retrying.
 * (Do not treat "rest error" alone as signal: our REST helper prefixes every non-2xx, including 400/42703.)
 */
export function isNonRetryableDbErrorMessage(message: string): boolean {
  const m = (message || '').toLowerCase()
  if (m.includes('42703') || m.includes('42p01') || m.includes('42p02') || m.includes('undefined_column')) {
    return true
  }
  if (m.includes('column') && m.includes('does not exist')) return true
  if (m.includes('could not find') && m.includes('column')) return true
  if (/rest error:\s*supabase\s+4\d{2}/i.test(message)) return true
  return false
}

/**
 * Determines if an error is worth retrying.
 * Returns true for connection/timeout errors, false for validation/logic errors.
 */
export function isRetryableError(error: Error): boolean {
  if (isNonRetryableDbErrorMessage(error.message)) return false

  // Our `fetchRafflesViaRestRaw` throws `rest error: Supabase 5xx ...` for upstream failures
  if (/rest error:\s*supabase\s+5\d{2}/i.test(error.message)) return true

  const message = error.message.toLowerCase()
  const retryablePatterns = [
    'connection',
    'timeout',
    'network',
    'econnrefused',
    'econnreset',
    'enotfound',
    'etimedout',
    'socket',
    'fetch failed',
    'failed to fetch',
    'upstream',
    'disconnect',
    'reset',
    '500',
    '502',
    '503',
    '504',
    'service unavailable',
    '522',
    '524',
    // Supabase-specific patterns
    'postgrest',
    'pgrst',
    'connection terminated',
    'server closed the connection',
    'connection reset',
  ]

  return retryablePatterns.some((pattern) => message.includes(pattern))
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Wraps a Supabase query builder with retry logic.
 * Automatically retries on connection failures.
 * 
 * @example
 * ```typescript
 * const { data, error } = await withQueryRetry(
 *   supabase.from('raffles').select('*').eq('id', id).single()
 * )
 * ```
 */
export async function withQueryRetry<T>(
  queryPromise: PromiseLike<{ data: T | null; error: any }>,
  options: RetryOptions = {}
): Promise<{ data: T | null; error: any }> {
  return withRetry(async () => {
    const result = await queryPromise
    
    // If there's an error, throw it so retry logic can handle it
    if (result.error) {
      throw new Error(result.error.message || 'Database query failed')
    }
    
    return result
  }, options)
}
