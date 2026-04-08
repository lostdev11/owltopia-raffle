import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { withRetry } from '@/lib/db-retry'

export type AdminRole = 'full' | 'raffle_creator'

/**
 * Check if a wallet address is an admin (any role)
 */
export async function isAdmin(walletAddress: string): Promise<boolean> {
  const role = await getAdminRole(walletAddress)
  return role !== null
}

/**
 * Get admin role for a wallet, or null if not an admin
 */
const ADMIN_IN_CHUNK = 120

/**
 * Returns wallets that exist in the admins table (any role). Chunked for PostgREST .in() limits.
 */
export async function getWalletsWithAdminRole(walletAddresses: string[]): Promise<Set<string>> {
  const normalized = [...new Set(walletAddresses.map((w) => (typeof w === 'string' ? w.trim() : '')).filter(Boolean))]
  if (normalized.length === 0) return new Set()

  const db = getSupabaseForServerRead(supabase)
  const result = new Set<string>()

  for (let i = 0; i < normalized.length; i += ADMIN_IN_CHUNK) {
    const chunk = normalized.slice(i, i + ADMIN_IN_CHUNK)
    const rows = await withRetry(async () => {
      const { data, error } = await db.from('admins').select('wallet_address').in('wallet_address', chunk)
      if (error) {
        console.error('Error batch-checking admins:', error.message || 'Unknown error')
        return []
      }
      return data ?? []
    }, { maxRetries: 1 })

    for (const row of rows) {
      const addr = typeof row?.wallet_address === 'string' ? row.wallet_address.trim() : ''
      if (addr) result.add(addr)
    }
  }

  return result
}

export async function getAdminRole(walletAddress: string): Promise<AdminRole | null> {
  const normalized = typeof walletAddress === 'string' ? walletAddress.trim() : ''
  if (!normalized) {
    return null
  }

  const db = getSupabaseForServerRead(supabase)
  return withRetry(async () => {
    const { data, error } = await db
      .from('admins')
      .select('role')
      .eq('wallet_address', normalized)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return null
      }
      console.error('Error checking admin role:', error.message || 'Unknown error')
      return null
    }

    const role = data?.role
    if (role === 'full' || role === 'raffle_creator') {
      return role
    }
    return 'full'
  }, { maxRetries: 0 })
}

/**
 * Get all admins (admin only function)
 */
export async function getAdmins() {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('admins')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching admins:', error.message || 'Unknown error')
    return []
  }

  return data || []
}

/**
 * Add a new admin (admin only function).
 * role: 'full' = Owl Vision + all actions; 'raffle_creator' = create raffles only
 */
export async function addAdmin(
  walletAddress: string,
  createdBy?: string,
  role: AdminRole = 'full'
) {
  const { data, error } = await getSupabaseAdmin()
    .from('admins')
    .insert({
      wallet_address: walletAddress,
      created_by: createdBy || null,
      role: role === 'raffle_creator' ? 'raffle_creator' : 'full',
    })
    .select()
    .single()

  if (error) {
    console.error('Error adding admin:', error.message || 'Unknown error')
    return null
  }

  return data
}
