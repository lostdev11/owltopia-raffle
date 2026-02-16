/**
 * Safe error handling for API responses.
 * In production we never expose env variable names, stack traces, or internal details.
 */

const isDev = process.env.NODE_ENV === 'development'

/** Substrings that must never appear in responses (env/config leakage) */
const REDACT_PATTERNS = [
  /\.env\.local/gi,
  /NEXT_PUBLIC_/gi,
  /SUPABASE_/gi,
  /RAFFLE_RECIPIENT/gi,
  /SOLANA_RPC/gi,
  /SESSION_SECRET/gi,
  /AUTH_SECRET/gi,
  /service_role/gi,
  /private.?key/gi,
]

function redactMessage(msg: string): string {
  let out = msg
  for (const pattern of REDACT_PATTERNS) {
    out = out.replace(pattern, '[redacted]')
  }
  return out
}

/**
 * Returns a message safe to send to the client.
 * - Production: always "Internal server error" (no env names, no stack, no raw error text).
 * - Development: redacted error message (env-like strings removed).
 */
export function safeErrorMessage(error: unknown): string {
  if (isDev) {
    const msg = error instanceof Error ? error.message : String(error)
    return redactMessage(msg)
  }
  return 'Internal server error'
}

/**
 * Use for user-facing error payloads. In production, details are omitted.
 */
export function safeErrorDetails(error: unknown): string | undefined {
  if (!isDev) return undefined
  const msg = error instanceof Error ? error.message : String(error)
  return redactMessage(msg)
}

/**
 * Use when you need a generic 5xx message that never leaks env or stack.
 */
export const GENERIC_ERROR_MESSAGE = 'Internal server error'
