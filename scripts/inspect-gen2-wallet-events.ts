/**
 * Read-only: list the recorded Gen2 mint events for a wallet (which phase each landed in).
 *   npx --yes tsx --env-file=.env.local scripts/inspect-gen2-wallet-events.ts <wallet>
 */
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function main() {
  const wallet = process.argv[2]?.trim()
  if (!wallet) throw new Error('Usage: inspect-gen2-wallet-events.ts <wallet>')
  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) throw new Error('gen2 launch not found')

  const { data } = await getSupabaseAdmin()
    .from('owl_center_mint_events')
    .select('phase, quantity, network, tx_signature, created_at')
    .eq('launch_id', launch.id)
    .eq('wallet_address', wallet)
    .order('created_at', { ascending: false })

  const rows = data ?? []
  console.log(`wallet ${wallet} — ${rows.length} mint event(s)`) 
  for (const r of rows as Array<Record<string, unknown>>) {
    console.log(`  ${String(r.created_at)}  phase=${String(r.phase)} qty=${String(r.quantity)} net=${String(r.network)} tx=${String(r.tx_signature)}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('failed:', e)
    process.exit(1)
  })
