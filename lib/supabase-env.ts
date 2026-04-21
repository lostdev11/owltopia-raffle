/**
 * Resolve Supabase API keys: prefer publishable + secret (`sb_publishable_` / `sb_secret_`)
 * over legacy JWT `anon` / `service_role`.
 *
 * @see https://supabase.com/docs/guides/api/api-keys
 */
export function getSupabasePublishableKey(): string | undefined {
  const k =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  return k || undefined
}

export function getSupabaseSecretKey(): string | undefined {
  const k =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return k || undefined
}
