import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { extractMintedNftMintsFromTx } from '@/lib/owl-center/parse-mint-tx-nfts'
import type { OwlMintNetwork } from '@/lib/solana/network'

/** Collect unique minted NFT addresses from owl_center_mint_events for a launch. */
export async function collectMintedNftMintsForLaunch(launchId: string): Promise<string[]> {
  const db = getSupabaseAdmin()
  // Paginate past PostgREST's 1000-row default cap so the hash list still covers every mint event
  // once the collection exceeds 1000 recorded mints.
  const pageSize = 1000
  let from = 0
  const data: Array<Record<string, unknown>> = []
  for (;;) {
    const { data: rows, error } = await db
      .from('owl_center_mint_events')
      .select('minted_nft_mints, tx_signature, network')
      .eq('launch_id', launchId)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) return []
    const batch = rows ?? []
    data.push(...(batch as Array<Record<string, unknown>>))
    if (batch.length < pageSize) break
    from += pageSize
  }

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

/**
 * Collect the unique minted NFT addresses a specific set of wallets minted for a launch, newest
 * first. Used by the "My mints" view so a connected wallet (and its linked cluster wallets) sees
 * exactly the owls it minted. Falls back to deriving mints from the tx signature on-chain when a
 * row recorded no minted_nft_mints (early sessions only stored the signature).
 */
export async function collectMintedNftMintsForWallets(
  launchId: string,
  wallets: string[],
  network: OwlMintNetwork
): Promise<string[]> {
  const walletList = Array.from(
    new Set(wallets.map((w) => String(w ?? '').trim()).filter(Boolean))
  )
  if (!walletList.length) return []

  const db = getSupabaseAdmin()
  // Paginate past PostgREST's 1000-row default cap so a large cluster's mints aren't truncated.
  const pageSize = 1000
  let from = 0
  const data: Array<Record<string, unknown>> = []
  for (;;) {
    const { data: rows, error } = await db
      .from('owl_center_mint_events')
      .select('minted_nft_mints, tx_signature, network')
      .eq('launch_id', launchId)
      .eq('network', network)
      .in('wallet_address', walletList)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) return []
    const batch = rows ?? []
    data.push(...(batch as Array<Record<string, unknown>>))
    if (batch.length < pageSize) break
    from += pageSize
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const row of data) {
    const r = row as {
      minted_nft_mints?: string[] | null
      tx_signature?: string | null
    }
    const list = Array.isArray(r.minted_nft_mints) ? r.minted_nft_mints : []
    let mints = list.map((m) => String(m ?? '').trim()).filter(Boolean)

    if (!mints.length && r.tx_signature?.trim()) {
      try {
        mints = await extractMintedNftMintsFromTx(r.tx_signature.trim(), network)
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
