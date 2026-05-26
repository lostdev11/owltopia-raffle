/**
 * One-off: list open (active/pending) staking positions for given wallets.
 * Usage: node --env-file=.env.local scripts/query-open-nests.mjs
 */
import { createClient } from '@supabase/supabase-js'

const wallets = [
  'DqWmricjrR6V6Nn6BecDVEacm1wcNc3du1JLpXnYgzXN',
  'Ex8f4UBxqUA9JEygearMWYCndsjc8LzP7iPFtqauRo9s',
]

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const db = createClient(url, key)
const { data, error } = await db
  .from('staking_positions')
  .select(
    'id,wallet_address,status,sync_status,asset_identifier,external_reference,stake_signature,unstake_signature,last_transaction_error,pool_id,staked_at,unlock_at,amount,claimed_rewards'
  )
  .in('wallet_address', wallets)
  .in('status', ['active', 'pending'])
  .order('wallet_address')
  .order('staked_at', { ascending: false })

if (error) {
  console.error(error)
  process.exit(1)
}

const poolIds = [...new Set((data ?? []).map((r) => r.pool_id))]
let pools = []
if (poolIds.length > 0) {
  const { data: poolRows, error: poolErr } = await db
    .from('staking_pools')
    .select('id,slug,name,asset_type,adapter_mode,collection_key')
    .in('id', poolIds)
  if (poolErr) {
    console.error(poolErr)
    process.exit(1)
  }
  pools = poolRows ?? []
}
const poolById = Object.fromEntries(pools.map((p) => [p.id, p]))

const rows = (data ?? []).map((r) => ({ ...r, pool: poolById[r.pool_id] ?? null }))
console.log(JSON.stringify(rows, null, 2))
