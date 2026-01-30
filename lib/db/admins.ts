import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { withRetry } from '@/lib/db-retry'

/**
 * Check if a wallet address is an admin
 */
export async function isAdmin(walletAddress: string): Promise<boolean> {
  if (!walletAddress) {
    return false
  }

  const db = getSupabaseForServerRead(supabase)
  return withRetry(async () => {
    const { data, error } = await db
      .from('admins')
      .select('id')
      .eq('wallet_address', walletAddress)
      .single()

    if (error) {
      // If no admin found, error is expected
      if (error.code === 'PGRST116') {
        return false
      }
      console.error('Error checking admin status:', error)
      return false
    }

    return !!data
  }, { maxRetries: 2 })
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
    console.error('Error fetching admins:', error)
    return []
  }

  return data || []
}

/**
 * Add a new admin (admin only function)
 */
export async function addAdmin(walletAddress: string, createdBy?: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('admins')
    .insert({
      wallet_address: walletAddress,
      created_by: createdBy || null,
    })
    .select()
    .single()

  if (error) {
    console.error('Error adding admin:', error)
    return null
  }

  return data
}
