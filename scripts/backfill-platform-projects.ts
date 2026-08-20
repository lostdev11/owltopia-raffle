/**
 * Backfill raffles.nft_collection_mint + platform_projects from historical NFT raffles.
 *
 * Dry run (default — no writes):
 *   npx --yes tsx scripts/backfill-platform-projects.ts
 *
 * Repair unknown display names (fetch collection NFT metadata):
 *   npx --yes tsx scripts/backfill-platform-projects.ts --repair-names
 *   npx --yes tsx scripts/backfill-platform-projects.ts --repair-names --commit
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY, HELIUS_API_KEY.
 */
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'

import {
  extractDasAssetCollectionMint,
  extractDasAssetCollectionName,
} from '../lib/helius/das-asset-collection'
import { fetchDasAssetBatchFromHelius, fetchNftMintMetaBatchFromHelius, pickImageFromHeliusAsset } from '../lib/nft-helius-image'
import { recomputePlatformProjectFromStats, updatePlatformProjectCrm } from '../lib/db/platform-projects'
import { sanitizeLaunchMintPubkey } from '../lib/solana/validate-pubkey'
import { getSupabasePublishableKey, getSupabaseSecretKey } from '../lib/supabase-env'

loadEnvConfig(process.cwd())

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function inferNameFromRaffleTitle(title: string): string | null {
  let t = title.trim()
  if (!t) return null
  t = t.replace(/\s*#\s*\d+[\s\S]*$/i, '').trim()
  t = t.replace(/[.\s]+$/g, '').trim()
  t = t.replace(/\s+/g, ' ')
  if (t.length < 2 || t.length > 80) return null
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return null
  return t
}

async function repairUnknownNames(commit: boolean): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = getSupabaseSecretKey() || getSupabasePublishableKey()
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or Supabase secret/publishable key')
  }
  if (!process.env.HELIUS_API_KEY?.trim()) {
    throw new Error('Missing HELIUS_API_KEY')
  }

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb
    .from('platform_projects')
    .select('collection_mint, display_name, image_url')
    .eq('display_name', 'Unknown collection')
  if (error) throw new Error(error.message)
  const unknown = (data ?? []) as Array<{
    collection_mint: string
    display_name: string
    image_url: string | null
  }>
  console.log(`Unknown collection rows: ${unknown.length}`)
  if (unknown.length === 0) return

  const mints = unknown.map((r) => r.collection_mint)
  const metaByMint = await fetchNftMintMetaBatchFromHelius(mints, { preferMainnet: true })

  const stillUnknown: string[] = []
  const resolved = new Map<string, { name: string; image: string | null }>()
  for (const mint of mints) {
    const meta = metaByMint.get(mint)
    const name = meta?.name?.trim()
    if (name && name.toLowerCase() !== 'unknown collection') {
      resolved.set(mint, { name, image: meta?.image?.trim() || null })
    } else {
      stillUnknown.push(mint)
    }
  }
  console.log(`Named from collection mint DAS: ${resolved.size}`)

  if (stillUnknown.length > 0) {
    const { data: raffles, error: raffleErr } = await sb
      .from('raffles')
      .select('nft_collection_mint, nft_collection_name, title')
      .in('nft_collection_mint', stillUnknown)
    if (raffleErr) throw new Error(raffleErr.message)
    const byMint = new Map<string, string[]>()
    for (const row of raffles ?? []) {
      const mint = typeof row.nft_collection_mint === 'string' ? row.nft_collection_mint : ''
      if (!mint) continue
      const fromCol = typeof row.nft_collection_name === 'string' ? row.nft_collection_name.trim() : ''
      const fromTitle =
        typeof row.title === 'string' ? inferNameFromRaffleTitle(row.title) : null
      const candidate = fromCol || fromTitle
      if (!candidate) continue
      const list = byMint.get(mint) ?? []
      list.push(candidate)
      byMint.set(mint, list)
    }
    for (const mint of stillUnknown) {
      const names = byMint.get(mint) ?? []
      if (names.length === 0) continue
      const counts = new Map<string, number>()
      for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]
      if (best?.[0]) resolved.set(mint, { name: best[0], image: null })
    }
    console.log(`Named after title/collection-field fallback: ${resolved.size}`)
  }

  if (!commit) {
    for (const [mint, hit] of [...resolved.entries()].slice(0, 20)) {
      console.log(`  ${hit.name}  ${mint.slice(0, 6)}…`)
    }
    console.log(`Dry run. Re-run with --repair-names --commit to write ${resolved.size} names.`)
    return
  }

  let updated = 0
  for (const row of unknown) {
    const hit = resolved.get(row.collection_mint)
    if (!hit) continue
    await updatePlatformProjectCrm(row.collection_mint, { display_name: hit.name })
    if (!row.image_url && hit.image) {
      await sb
        .from('platform_projects')
        .update({ image_url: hit.image })
        .eq('collection_mint', row.collection_mint)
    }
    updated += 1
  }
  console.log(`Updated display names: ${updated}`)
}

type RaffleRow = {
  id: string
  nft_mint_address: string | null
  nft_collection_mint: string | null
  nft_collection_name: string | null
  image_url: string | null
  promo_x_handle: string | null
  creator_wallet: string | null
  created_at: string
}

async function main() {
  const commit = hasFlag('commit')
  if (hasFlag('repair-names')) {
    await repairUnknownNames(commit)
    return
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = getSupabaseSecretKey() || getSupabasePublishableKey()
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or Supabase secret/publishable key')
  }
  if (!process.env.HELIUS_API_KEY?.trim()) {
    throw new Error('Missing HELIUS_API_KEY')
  }

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data, error } = await sb
    .from('raffles')
    .select(
      'id,nft_mint_address,nft_collection_mint,nft_collection_name,image_url,promo_x_handle,creator_wallet,created_at'
    )
    .eq('prize_type', 'nft')
    .not('nft_mint_address', 'is', null)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  const raffles = (data ?? []) as RaffleRow[]
  console.log(`NFT raffles with prize mint: ${raffles.length}`)

  const needDas = raffles.filter((r) => !sanitizeLaunchMintPubkey(r.nft_collection_mint) && r.nft_mint_address)
  console.log(`Need DAS collection resolve: ${needDas.length}`)

  const dasByPrize = new Map<string, { mint: string | null; name: string | null; image: string | null }>()
  const prizeIds = [...new Set(needDas.map((r) => r.nft_mint_address!.trim()).filter(Boolean))]
  const CHUNK = 20
  for (let i = 0; i < prizeIds.length; i += CHUNK) {
    const chunk = prizeIds.slice(i, i + CHUNK)
    const payloads = await fetchDasAssetBatchFromHelius(chunk, { preferMainnet: true })
    for (const prizeMint of chunk) {
      const asset = payloads.get(prizeMint)
      dasByPrize.set(prizeMint, {
        mint: sanitizeLaunchMintPubkey(asset ? extractDasAssetCollectionMint(asset) : null),
        name: asset ? extractDasAssetCollectionName(asset) : null,
        image: asset ? pickImageFromHeliusAsset(asset) : null,
      })
    }
    console.log(`DAS ${Math.min(i + CHUNK, prizeIds.length)}/${prizeIds.length}`)
    await new Promise((r) => setTimeout(r, 250))
  }

  type Agg = {
    collectionMint: string
    displayName: string
    imageUrl: string | null
    twitterHandle: string | null
    hostWallet: string | null
    raffleCount: number
    firstSeenAt: string
    lastSeenAt: string
    raffleIds: string[]
  }
  const byCollection = new Map<string, Agg>()
  let skippedNoCollection = 0
  const raffleMintUpdates: Array<{ id: string; mint: string }> = []

  for (const raffle of raffles) {
    const prizeMint = raffle.nft_mint_address?.trim() || ''
    let collectionMint = sanitizeLaunchMintPubkey(raffle.nft_collection_mint)
    const das = prizeMint ? dasByPrize.get(prizeMint) : undefined
    if (!collectionMint) collectionMint = das?.mint ?? null
    if (!collectionMint) {
      skippedNoCollection += 1
      continue
    }
    if (!sanitizeLaunchMintPubkey(raffle.nft_collection_mint)) {
      raffleMintUpdates.push({ id: raffle.id, mint: collectionMint })
    }
    const name =
      raffle.nft_collection_name?.trim() || das?.name?.trim() || 'Unknown collection'
    const existing = byCollection.get(collectionMint)
    if (!existing) {
      byCollection.set(collectionMint, {
        collectionMint,
        displayName: name,
        imageUrl: raffle.image_url || das?.image || null,
        twitterHandle: raffle.promo_x_handle,
        hostWallet: raffle.creator_wallet,
        raffleCount: 1,
        firstSeenAt: raffle.created_at,
        lastSeenAt: raffle.created_at,
        raffleIds: [raffle.id],
      })
      continue
    }
    existing.raffleCount += 1
    existing.raffleIds.push(raffle.id)
    if (raffle.created_at < existing.firstSeenAt) existing.firstSeenAt = raffle.created_at
    if (raffle.created_at >= existing.lastSeenAt) {
      existing.lastSeenAt = raffle.created_at
      existing.hostWallet = raffle.creator_wallet
    }
    if (!existing.imageUrl && (raffle.image_url || das?.image)) {
      existing.imageUrl = raffle.image_url || das?.image || null
    }
    if (!existing.twitterHandle && raffle.promo_x_handle) {
      existing.twitterHandle = raffle.promo_x_handle
    }
    if (existing.displayName === 'Unknown collection' && name !== 'Unknown collection') {
      existing.displayName = name
    }
  }

  console.log(`Collections resolved: ${byCollection.size}`)
  console.log(`Skipped (no collection grouping): ${skippedNoCollection}`)
  console.log(`Raffle mint updates: ${raffleMintUpdates.length}`)

  const unnamed = [...byCollection.values()].filter((c) => c.displayName === 'Unknown collection')
  if (unnamed.length > 0) {
    const metaByMint = await fetchNftMintMetaBatchFromHelius(
      unnamed.map((c) => c.collectionMint),
      { preferMainnet: true }
    )
    let named = 0
    for (const row of unnamed) {
      const n = metaByMint.get(row.collectionMint)?.name?.trim()
      if (n) {
        row.displayName = n
        named += 1
      }
    }
    console.log(`Filled collection names from collection-mint DAS: ${named}/${unnamed.length}`)
  }

  if (!commit) {
    console.log('Dry run. Re-run with --commit to write raffles + platform_projects.')
    return
  }

  let updatedRaffles = 0
  for (const row of raffleMintUpdates) {
    const { error: upErr } = await sb
      .from('raffles')
      .update({ nft_collection_mint: row.mint })
      .eq('id', row.id)
    if (upErr) {
      console.warn(`raffle ${row.id} mint update failed:`, upErr.message)
      continue
    }
    updatedRaffles += 1
  }
  console.log(`Updated raffle collection mints: ${updatedRaffles}`)

  let upserted = 0
  for (const stats of byCollection.values()) {
    await recomputePlatformProjectFromStats({
      collectionMint: stats.collectionMint,
      displayName: stats.displayName,
      imageUrl: stats.imageUrl,
      twitterHandle: stats.twitterHandle,
      hostWallet: stats.hostWallet,
      raffleCount: stats.raffleCount,
      firstSeenAt: stats.firstSeenAt,
      lastSeenAt: stats.lastSeenAt,
    })
    upserted += 1
  }
  console.log(`Upserted platform_projects: ${upserted}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
