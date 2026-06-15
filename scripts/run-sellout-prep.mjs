/**
 * Run sell-out marketplace prep (standalone — no Next.js server-only imports).
 *
 * Usage:
 *   node --env-file=.env.local scripts/run-sellout-prep.mjs --slug=sub-feae56d904034b21a2edf92e301c5eae
 */

import { createClient } from '@supabase/supabase-js'

const PAPERS_SLUG_DEFAULT = 'sub-feae56d904034b21a2edf92e301c5eae'

function parseArgs(argv) {
  let slug = null
  let launchId = null
  for (const arg of argv) {
    if (arg.startsWith('--slug=')) slug = arg.slice('--slug='.length).trim().toLowerCase()
    else if (arg.startsWith('--launch-id=')) launchId = arg.slice('--launch-id='.length).trim()
  }
  return { slug, launchId }
}

function suggestMagicEdenCollectionUrl(collectionMint, network = 'mainnet') {
  const mint = String(collectionMint ?? '').trim()
  if (!mint) return null
  if (network === 'devnet') return `https://magiceden.io/marketplace/devnet/${encodeURIComponent(mint)}`
  return `https://magiceden.io/marketplace/${encodeURIComponent(mint)}`
}

function suggestTensorCollectionUrl(collectionMint) {
  const mint = String(collectionMint ?? '').trim()
  if (!mint) return null
  return `https://tensor.trade/trade/${encodeURIComponent(mint)}`
}

function collectMintsFromEvents(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    const list = Array.isArray(row.minted_nft_mints) ? row.minted_nft_mints : []
    for (const m of list) {
      const addr = String(m ?? '').trim()
      if (addr && !seen.has(addr)) {
        seen.add(addr)
        out.push(addr)
      }
    }
  }
  return out
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY')
    process.exit(1)
  }

  const { slug: slugArg, launchId: launchIdArg } = parseArgs(process.argv.slice(2))
  const db = createClient(url, key, { auth: { persistSession: false } })

  let launchQuery = db.from('owl_center_launches').select('*')
  if (launchIdArg) launchQuery = launchQuery.eq('id', launchIdArg)
  else launchQuery = launchQuery.eq('slug', slugArg || PAPERS_SLUG_DEFAULT)

  const { data: launch, error: launchErr } = await launchQuery.maybeSingle()
  if (launchErr || !launch) {
    console.error('Launch not found', launchErr?.message)
    process.exit(1)
  }

  const { data: events, error: evErr } = await db
    .from('owl_center_mint_events')
    .select('minted_nft_mints, created_at')
    .eq('launch_id', launch.id)
    .order('created_at', { ascending: true })
  if (evErr) {
    console.error(evErr.message)
    process.exit(1)
  }

  const mints = collectMintsFromEvents(events ?? [])
  const hashListText = mints.join('\n')
  const network = launch.mint_network === 'devnet' ? 'devnet' : 'mainnet'
  const collectionMint = launch.collection_mint?.trim() || null
  const meUrl = collectionMint ? suggestMagicEdenCollectionUrl(collectionMint, network) : null
  const tensorUrl = collectionMint ? suggestTensorCollectionUrl(collectionMint) : null
  const hashListPath = `/api/owl-center/collections/${launch.slug}/hash-list`
  const now = new Date().toISOString()

  const { data: row, error: upsertErr } = await db
    .from('owl_center_marketplace_readiness')
    .upsert(
      {
        launch_id: launch.id,
        collection_mint: collectionMint,
        candy_machine_id: launch.candy_machine_id,
        hash_list_text: hashListText || null,
        hash_list_url: hashListPath,
        magic_eden_url: meUrl,
        tensor_url: tensorUrl,
        metadata_status: 'READY_FOR_INDEXING',
        magic_eden_status: 'READY_FOR_INDEXING',
        tensor_status: 'READY_FOR_INDEXING',
        sellout_prepared_at: now,
        notes: `Sell-out prep ${now} · ${mints.length} mint(s) in hash list.`,
        updated_at: now,
      },
      { onConflict: 'launch_id' }
    )
    .select('*')
    .single()

  if (upsertErr) {
    console.error('Upsert failed', upsertErr.message)
    process.exit(1)
  }

  await db.from('owl_center_launches').update({
    magic_eden_url: meUrl,
    tensor_url: tensorUrl,
    marketplace_ready: true,
    updated_at: now,
  }).eq('id', launch.id)

  await db.from('owl_center_activity_logs').insert({
    launch_id: launch.id,
    message: `SELL_OUT marketplace prep · ${mints.length} mint(s) · hash list ready · ME=${meUrl ?? '—'}`,
    event_type: 'system',
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        launch_id: launch.id,
        slug: launch.slug,
        mint_count: mints.length,
        magic_eden_url: meUrl,
        tensor_url: tensorUrl,
        hash_list_download_path: hashListPath,
        marketplace: row,
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
