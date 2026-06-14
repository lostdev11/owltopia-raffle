import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { extractMintedNftMintsFromTx } from '@/lib/owl-center/parse-mint-tx-nfts'
import type { OwlMintNetwork } from '@/lib/solana/network'

/** Collect unique minted NFT addresses from owl_center_mint_events for a launch. */
export async function collectMintedNftMintsForLaunch(launchId: string): Promise<string[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_mint_events')
    .select('minted_nft_mints, tx_signature, network')
    .eq('launch_id', launchId)
    .order('created_at', { ascending: true })

  if (error || !data) return []

  const seen = new Set<string>()
  const out: string[] = []
  for (const row of data) {
    const r = row as {
      minted_nft_mints?: string[] | null
      tx_signature?: string | null
      network?: string | null
    }
    const list = Array.isArray(r.minted_nft_mints) ? r.minted_nft_mints : []
    const fromRow = list.map((m) => String(m ?? '').trim()).filter(Boolean)

    let mints = fromRow
    if (!mints.length && r.tx_signature?.trim()) {
      const net: OwlMintNetwork = r.network === 'devnet' ? 'devnet' : 'mainnet'
      try {
        mints = await extractMintedNftMintsFromTx(r.tx_signature.trim(), net)
      } catch {
        mints = []
      }
    }

    for (const m of mints) {
      if (!seen.has(m)) {
        seen.add(m)
        out.push(m)
      }
    }
  }
  return out
}
