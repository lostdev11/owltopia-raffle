import { createClient, SupabaseClient } from '@supabase/supabase-js'

let adminClient: SupabaseClient | null = null

/**
 * Use service role for server-side reads when SUPABASE_SERVICE_ROLE_KEY is set (bypasses RLS).
 * Pass the anon client as fallback when the key is missing or getSupabaseAdmin() throws.
 * Use in getRaffles, getEntriesByRaffleId, isAdmin, etc. so server-rendered pages load data reliably.
 */
export function getSupabaseForServerRead(fallback: SupabaseClient): SupabaseClient {
  if (typeof process !== 'undefined' && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      return getSupabaseAdmin()
    } catch {
      return fallback
    }
  }
  return fallback
}
let lastHealthCheck = 0
const HEALTH_CHECK_INTERVAL = 60000 // Check health every 60 seconds

/**
 * Server-only Supabase client with service_role key.
 * Use this for all write operations (insert/update/delete) so they bypass RLS.
 * Required after migration 020 (permissive RLS policies removed).
 *
 * Set SUPABASE_SERVICE_ROLE_KEY in your server environment (e.g. .env.local).
 * Never expose this key to the client.
 * 
 * Includes automatic reconnection handling for brief database restarts.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set for server-side writes. ' +
      'Add them to .env.local. Get the service role key from Supabase Dashboard → Settings → API.'
    )
  }

  // Recreate client if health check indicates connection issues
  const now = Date.now()
  if (adminClient && now - lastHealthCheck > HEALTH_CHECK_INTERVAL) {
    lastHealthCheck = now
    // Perform a lightweight health check
    adminClient.from('raffles').select('count', { count: 'exact', head: true }).then(
      () => {
        // Connection is healthy
      },
      (error) => {
        // Connection failed, recreate client
        console.warn('Admin client health check failed, recreating connection:', error)
        adminClient = null
      }
    )
  }

  if (adminClient) {
    return adminClient
  }

  adminClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        'x-client-info': 'owl-raffle-admin',
      },
    },
    db: {
      schema: 'public',
    },
  })
  
  lastHealthCheck = now
  return adminClient
}
