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

export async function sumConfirmedPresaleSold(): Promise<number> {
  const db = getSupabaseAdmin()
  const page = 1000
  let from = 0
  let sum = 0
  for (;;) {
    const { data, error } = await db
      .from('gen2_presale_purchases')
      .select('quantity')
      .eq('status', 'confirmed')
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
