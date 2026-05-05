import { getSupabaseAdmin } from '@/lib/supabase-admin'

/** PostgREST when migrations 093+ are not applied yet (local / fresh DB). */
export function isGen2SchemaMissingError(err: unknown): boolean {
  const msg =
    typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message: unknown }).message === 'string'
      ? (err as { message: string }).message
      : err instanceof Error
        ? err.message
        : String(err)
  return (
    msg.includes('Could not find the table') ||
    msg.includes('schema cache') ||
    msg.includes('PGRST205')
  )
}

function allowDegradedGen2Read(): boolean {
  return process.env.NODE_ENV !== 'production'
}

async function sumConfirmedPurchasesPaginated(): Promise<number> {
  const db = getSupabaseAdmin()
  const page = 1000
  let from = 0
  let sum = 0
  for (;;) {
    const { data, error } = await db
      .from('gen2_presale_purchases')
      .select('quantity')
      .eq('status', 'confirmed')
      .order('id', { ascending: true })
      .range(from, from + page - 1)
    if (error) {
      if (allowDegradedGen2Read() && isGen2SchemaMissingError(error)) {
        console.warn(
          '[gen2-presale] gen2_presale_purchases missing — returning sold=0. Apply supabase/migrations/093_gen2_presale.sql (and 094) to your project.'
        )
        return 0
      }
      throw new Error(error.message)
    }
    const rows = data ?? []
    for (const r of rows) {
      sum += Number((r as { quantity?: number }).quantity ?? 0)
    }
    if (rows.length < page) break
    from += page
  }
  return sum
}

async function sumPurchasedMintsPaginated(): Promise<number> {
  const db = getSupabaseAdmin()
  const page = 1000
  let from = 0
  let sum = 0
  for (;;) {
    const { data, error } = await db
      .from('gen2_presale_balances')
      .select('purchased_mints')
      .order('wallet', { ascending: true })
      .range(from, from + page - 1)
    if (error) {
      if (allowDegradedGen2Read() && isGen2SchemaMissingError(error)) {
        return 0
      }
      throw new Error(error.message)
    }
    const rows = data ?? []
    for (const r of rows) {
      sum += Number((r as { purchased_mints?: number }).purchased_mints ?? 0)
    }
    if (rows.length < page) break
    from += page
  }
  return sum
}

/**
 * Spots counted toward presale progress. Uses DB RPC aggregates when migration 097 is applied;
 * otherwise paginated reads with stable ordering. Takes the max of purchase-row totals vs
 * sum(purchased_mints) so progress stays correct if one side was backfilled or repaired.
 */
export async function sumConfirmedPresaleSold(): Promise<number> {
  const db = getSupabaseAdmin()
  try {
    const [{ data: soldRows, error: e1 }, { data: mintSum, error: e2 }] = await Promise.all([
      db.rpc('gen2_presale_sold_confirmed_quantity'),
      db.rpc('gen2_presale_sum_purchased_mints'),
    ])
    if (!e1 && !e2 && soldRows != null && mintSum != null) {
      const a = Number(soldRows)
      const b = Number(mintSum)
      if (Number.isFinite(a) && Number.isFinite(b)) {
        return Math.max(a, b)
      }
    }
  } catch {
    // fall through to legacy
  }

  const [fromPurchases, fromBalances] = await Promise.all([
    sumConfirmedPurchasesPaginated(),
    sumPurchasedMintsPaginated(),
  ])
  return Math.max(fromPurchases, fromBalances)
}

export type Gen2BalanceRow = {
  wallet: string
  purchased_mints: number
  gifted_mints: number
  used_mints: number
  available_mints: number
}

export async function getBalanceByWallet(wallet: string): Promise<Gen2BalanceRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('gen2_presale_available_balances').select('*').eq('wallet', wallet).maybeSingle()
  if (error) {
    if (allowDegradedGen2Read() && isGen2SchemaMissingError(error)) {
      console.warn(
        '[gen2-presale] gen2_presale_available_balances missing — returning null. Apply supabase/migrations/093_gen2_presale.sql (and 094) to your project.'
      )
      return null
    }
    throw new Error(error.message)
  }
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    wallet: String(r.wallet),
    purchased_mints: Number(r.purchased_mints ?? 0),
    gifted_mints: Number(r.gifted_mints ?? 0),
    used_mints: Number(r.used_mints ?? 0),
    available_mints: Number(r.available_mints ?? 0),
  }
}

const TX_SIG_IN_CHUNK = 200

/**
 * Which of the given presale `tx_signature` values already exist (batched IN queries).
 * Used by admin backfill to avoid one round-trip per signature.
 */
export async function getGen2PresaleExistingTxSignatures(signatures: string[]): Promise<Set<string>> {
  const db = getSupabaseAdmin()
  const out = new Set<string>()
  const uniq = [...new Set(signatures.map((s) => s.trim()).filter(Boolean))]
  for (let i = 0; i < uniq.length; i += TX_SIG_IN_CHUNK) {
    const chunk = uniq.slice(i, i + TX_SIG_IN_CHUNK)
    const { data, error } = await db
      .from('gen2_presale_purchases')
      .select('tx_signature')
      .in('tx_signature', chunk)
    if (error) {
      if (allowDegradedGen2Read() && isGen2SchemaMissingError(error)) {
        return out
      }
      throw new Error(error.message)
    }
    for (const row of data ?? []) {
      const tx = (row as { tx_signature?: string }).tx_signature
      if (tx) out.add(tx)
    }
  }
  return out
}

export type Gen2PresalePurchaseRowLite = {
  wallet: string
  quantity: number
}

/**
 * Purchase rows for the given tx signatures (batched). Used by admin backfill to re-verify amounts.
 */
export async function getGen2PresalePurchaseRowsBySignatures(
  signatures: string[]
): Promise<Map<string, Gen2PresalePurchaseRowLite>> {
  const db = getSupabaseAdmin()
  const out = new Map<string, Gen2PresalePurchaseRowLite>()
  const uniq = [...new Set(signatures.map((s) => s.trim()).filter(Boolean))]
  for (let i = 0; i < uniq.length; i += TX_SIG_IN_CHUNK) {
    const chunk = uniq.slice(i, i + TX_SIG_IN_CHUNK)
    const { data, error } = await db
      .from('gen2_presale_purchases')
      .select('tx_signature,wallet,quantity')
      .in('tx_signature', chunk)
    if (error) {
      if (allowDegradedGen2Read() && isGen2SchemaMissingError(error)) {
        return out
      }
      throw new Error(error.message)
    }
    for (const row of data ?? []) {
      const r = row as { tx_signature?: string; wallet?: string; quantity?: number }
      if (r.tx_signature) {
        out.set(String(r.tx_signature), {
          wallet: String(r.wallet ?? ''),
          quantity: Number(r.quantity ?? 0),
        })
      }
    }
  }
  return out
}

export type Gen2PresaleParticipant = {
  wallet: string
  /** Confirmed presale spots purchased (sum of recorded purchases). */
  purchased_spots: number
}

/** Public leaderboard: wallets with presale purchases, highest spot count first. */
export async function listGen2PresaleParticipants(limit: number): Promise<Gen2PresaleParticipant[]> {
  const db = getSupabaseAdmin()
  const cap = Math.min(500, Math.max(1, Math.floor(limit)))
  const { data, error } = await db
    .from('gen2_presale_balances')
    .select('wallet,purchased_mints')
    .gt('purchased_mints', 0)
    .order('purchased_mints', { ascending: false })
    .order('wallet', { ascending: true })
    .limit(cap)

  if (error) {
    if (allowDegradedGen2Read() && isGen2SchemaMissingError(error)) {
      return []
    }
    throw new Error(error.message)
  }

  return (data ?? []).map((r) => ({
    wallet: String((r as { wallet: string }).wallet),
    purchased_spots: Number((r as { purchased_mints?: number }).purchased_mints ?? 0),
  }))
}
