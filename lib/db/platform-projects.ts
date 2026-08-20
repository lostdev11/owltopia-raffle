import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { slugifyPlatformProject } from '@/lib/platform-projects/slug'
import { sanitizeLaunchMintPubkey } from '@/lib/solana/validate-pubkey'
import { listPartnerCommunityCreatorsAdmin } from '@/lib/db/partner-community-creators-admin'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const PLATFORM_PROJECT_OUTREACH_STATUSES = ['none', 'watchlist', 'contacted', 'skip'] as const
export type PlatformProjectOutreachStatus = (typeof PLATFORM_PROJECT_OUTREACH_STATUSES)[number]

export type PlatformProjectRow = {
  collection_mint: string
  slug: string
  display_name: string
  image_url: string | null
  twitter_handle: string | null
  raffle_count: number
  first_seen_at: string
  last_seen_at: string
  last_host_wallet: string | null
  outreach_status: PlatformProjectOutreachStatus
  notes: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export type PlatformProjectPublic = {
  collection_mint: string
  slug: string
  display_name: string
  image_url: string | null
  twitter_handle: string | null
  raffle_count: number
  first_seen_at: string
  last_seen_at: string
}

export type PlatformProjectAdminRow = PlatformProjectRow & {
  partner_host: boolean
}

const PUBLIC_COLUMNS =
  'collection_mint, slug, display_name, image_url, twitter_handle, raffle_count, first_seen_at, last_seen_at'

const ADMIN_COLUMNS =
  `${PUBLIC_COLUMNS}, last_host_wallet, outreach_status, notes, tags, created_at, updated_at`

function isOutreachStatus(raw: string): raw is PlatformProjectOutreachStatus {
  return (PLATFORM_PROJECT_OUTREACH_STATUSES as readonly string[]).includes(raw)
}

function mapRow(row: Record<string, unknown>): PlatformProjectRow {
  const statusRaw = typeof row.outreach_status === 'string' ? row.outreach_status : 'none'
  const tagsRaw = row.tags
  return {
    collection_mint: String(row.collection_mint ?? ''),
    slug: String(row.slug ?? ''),
    display_name: String(row.display_name ?? ''),
    image_url: typeof row.image_url === 'string' && row.image_url.trim() ? row.image_url.trim() : null,
    twitter_handle:
      typeof row.twitter_handle === 'string' && row.twitter_handle.trim()
        ? row.twitter_handle.trim()
        : null,
    raffle_count: Number.isFinite(Number(row.raffle_count)) ? Math.max(0, Math.floor(Number(row.raffle_count))) : 0,
    first_seen_at: String(row.first_seen_at ?? ''),
    last_seen_at: String(row.last_seen_at ?? ''),
    last_host_wallet:
      typeof row.last_host_wallet === 'string' && row.last_host_wallet.trim()
        ? row.last_host_wallet.trim()
        : null,
    outreach_status: isOutreachStatus(statusRaw) ? statusRaw : 'none',
    notes: typeof row.notes === 'string' && row.notes.trim() ? row.notes : null,
    tags: Array.isArray(tagsRaw)
      ? tagsRaw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim())
      : [],
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

function toPublic(row: PlatformProjectRow): PlatformProjectPublic {
  return {
    collection_mint: row.collection_mint,
    slug: row.slug,
    display_name: row.display_name,
    image_url: row.image_url,
    twitter_handle: row.twitter_handle,
    raffle_count: row.raffle_count,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
  }
}

export type UpsertPlatformProjectInput = {
  collectionMint: string
  displayName: string
  imageUrl?: string | null
  twitterHandle?: string | null
  hostWallet?: string | null
  seenAt?: string
  /** When true, increment raffle_count by 1 (live create). Backfill uses recompute instead. */
  incrementRaffleCount?: boolean
}

/**
 * Insert or refresh a project row. Does not overwrite existing name/image/twitter/notes.
 * Live raffle create should pass `incrementRaffleCount: true`.
 */
export async function upsertPlatformProjectFromRaffle(
  input: UpsertPlatformProjectInput
): Promise<PlatformProjectRow | null> {
  const collectionMint = sanitizeLaunchMintPubkey(input.collectionMint)
  if (!collectionMint) return null

  const displayName = input.displayName.trim() || 'Unknown collection'
  const slug = slugifyPlatformProject(displayName, collectionMint)
  const seenAt = input.seenAt?.trim() || new Date().toISOString()
  const imageUrl = input.imageUrl?.trim() || null
  const twitterHandle = input.twitterHandle?.trim() || null
  const hostWallet = input.hostWallet?.trim() || null
  const increment = input.incrementRaffleCount === true

  const sb = getSupabaseAdmin()
  const { data: existing, error: readErr } = await sb
    .from('platform_projects')
    .select(ADMIN_COLUMNS)
    .eq('collection_mint', collectionMint)
    .maybeSingle()

  if (readErr) throw new Error(readErr.message)

  if (!existing) {
    const { data, error } = await sb
      .from('platform_projects')
      .insert({
        collection_mint: collectionMint,
        slug,
        display_name: displayName,
        image_url: imageUrl,
        twitter_handle: twitterHandle,
        raffle_count: increment ? 1 : 0,
        first_seen_at: seenAt,
        last_seen_at: seenAt,
        last_host_wallet: hostWallet,
        outreach_status: 'none',
        notes: null,
        tags: [],
      })
      .select(ADMIN_COLUMNS)
      .single()
    if (error) {
      if (error.message?.toLowerCase().includes('duplicate') || error.code === '23505') {
        const retry = await sb
          .from('platform_projects')
          .select(ADMIN_COLUMNS)
          .eq('collection_mint', collectionMint)
          .maybeSingle()
        return retry.data ? mapRow(retry.data as Record<string, unknown>) : null
      }
      throw new Error(error.message)
    }
    return data ? mapRow(data as Record<string, unknown>) : null
  }

  const row = mapRow(existing as Record<string, unknown>)
  const patch: Record<string, unknown> = {
    last_seen_at: seenAt > row.last_seen_at ? seenAt : row.last_seen_at,
  }
  if (!row.display_name.trim()) patch.display_name = displayName
  if (!row.image_url && imageUrl) patch.image_url = imageUrl
  if (!row.twitter_handle && twitterHandle) patch.twitter_handle = twitterHandle
  if (hostWallet) patch.last_host_wallet = hostWallet
  if (increment) patch.raffle_count = row.raffle_count + 1

  const { data, error } = await sb
    .from('platform_projects')
    .update(patch)
    .eq('collection_mint', collectionMint)
    .select(ADMIN_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return data ? mapRow(data as Record<string, unknown>) : row
}

export type RecomputeProjectStats = {
  collectionMint: string
  displayName: string
  imageUrl?: string | null
  twitterHandle?: string | null
  hostWallet?: string | null
  raffleCount: number
  firstSeenAt: string
  lastSeenAt: string
}

/** Idempotent backfill: set counts/dates from aggregated raffle stats. Does not touch CRM fields. */
export async function recomputePlatformProjectFromStats(
  stats: RecomputeProjectStats
): Promise<void> {
  const collectionMint = sanitizeLaunchMintPubkey(stats.collectionMint)
  if (!collectionMint) return
  const displayName = stats.displayName.trim() || 'Unknown collection'
  const slug = slugifyPlatformProject(displayName, collectionMint)

  const sb = getSupabaseAdmin()
  const { data: existing, error: readErr } = await sb
    .from('platform_projects')
    .select(ADMIN_COLUMNS)
    .eq('collection_mint', collectionMint)
    .maybeSingle()
  if (readErr) throw new Error(readErr.message)

  if (!existing) {
    const { error } = await sb.from('platform_projects').insert({
      collection_mint: collectionMint,
      slug,
      display_name: displayName,
      image_url: stats.imageUrl?.trim() || null,
      twitter_handle: stats.twitterHandle?.trim() || null,
      raffle_count: Math.max(0, stats.raffleCount),
      first_seen_at: stats.firstSeenAt,
      last_seen_at: stats.lastSeenAt,
      last_host_wallet: stats.hostWallet?.trim() || null,
      outreach_status: 'none',
      notes: null,
      tags: [],
    })
    if (error && error.code !== '23505') throw new Error(error.message)
    return
  }

  const row = mapRow(existing as Record<string, unknown>)
  const { error } = await sb
    .from('platform_projects')
    .update({
      raffle_count: Math.max(0, stats.raffleCount),
      first_seen_at: stats.firstSeenAt < row.first_seen_at ? stats.firstSeenAt : row.first_seen_at,
      last_seen_at: stats.lastSeenAt > row.last_seen_at ? stats.lastSeenAt : row.last_seen_at,
      last_host_wallet: stats.hostWallet?.trim() || row.last_host_wallet,
      display_name: row.display_name.trim() ? row.display_name : displayName,
      image_url: row.image_url || stats.imageUrl?.trim() || null,
      twitter_handle: row.twitter_handle || stats.twitterHandle?.trim() || null,
    })
    .eq('collection_mint', collectionMint)
  if (error) throw new Error(error.message)
}

export async function listPlatformProjectsAdmin(): Promise<PlatformProjectAdminRow[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('platform_projects')
    .select(ADMIN_COLUMNS)
    .order('last_seen_at', { ascending: false })
    .order('display_name', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (data ?? []).map((r) => mapRow(r as Record<string, unknown>))

  const [partners, hostPairs] = await Promise.all([
    listPartnerCommunityCreatorsAdmin().catch(() => [] as Awaited<ReturnType<typeof listPartnerCommunityCreatorsAdmin>>),
    sb
      .from('raffles')
      .select('nft_collection_mint, creator_wallet')
      .not('nft_collection_mint', 'is', null),
  ])

  const partnerWallets = new Set(
    partners.filter((p) => p.is_active).map((p) => p.creator_wallet.trim()).filter(Boolean)
  )
  const partnerMints = new Set<string>()
  if (!hostPairs.error && Array.isArray(hostPairs.data)) {
    for (const row of hostPairs.data) {
      const mint = typeof row.nft_collection_mint === 'string' ? row.nft_collection_mint.trim() : ''
      const wallet = typeof row.creator_wallet === 'string' ? row.creator_wallet.trim() : ''
      if (!mint || !wallet) continue
      if ([...partnerWallets].some((pw) => walletsEqualSolana(pw, wallet))) {
        partnerMints.add(mint)
      }
    }
  }

  return rows.map((row) => ({
    ...row,
    partner_host:
      partnerMints.has(row.collection_mint) ||
      (row.last_host_wallet
        ? [...partnerWallets].some((pw) => walletsEqualSolana(pw, row.last_host_wallet!))
        : false),
  }))
}

export async function getPlatformProjectByMint(collectionMint: string): Promise<PlatformProjectRow | null> {
  const mint = sanitizeLaunchMintPubkey(collectionMint)
  if (!mint) return null
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('platform_projects')
    .select(ADMIN_COLUMNS)
    .eq('collection_mint', mint)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapRow(data as Record<string, unknown>) : null
}

export async function updatePlatformProjectCrm(
  collectionMint: string,
  patch: {
    display_name?: string
    notes?: string | null
    outreach_status?: PlatformProjectOutreachStatus
    tags?: string[]
    twitter_handle?: string | null
  }
): Promise<PlatformProjectRow> {
  const mint = sanitizeLaunchMintPubkey(collectionMint)
  if (!mint) throw new Error('Invalid collection mint')
  const update: Record<string, unknown> = {}
  if (typeof patch.display_name === 'string') {
    const n = patch.display_name.trim()
    if (!n) throw new Error('display_name cannot be empty')
    update.display_name = n
  }
  if (patch.notes !== undefined) {
    update.notes = typeof patch.notes === 'string' && patch.notes.trim() ? patch.notes : null
  }
  if (patch.outreach_status !== undefined) {
    if (!isOutreachStatus(patch.outreach_status)) throw new Error('Invalid outreach_status')
    update.outreach_status = patch.outreach_status
  }
  if (patch.tags !== undefined) {
    update.tags = patch.tags.map((t) => t.trim()).filter(Boolean)
  }
  if (patch.twitter_handle !== undefined) {
    update.twitter_handle =
      typeof patch.twitter_handle === 'string' && patch.twitter_handle.trim()
        ? patch.twitter_handle.trim().replace(/^@/, '')
        : null
  }
  if (Object.keys(update).length === 0) {
    const existing = await getPlatformProjectByMint(mint)
    if (!existing) throw new Error('Project not found')
    return existing
  }
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('platform_projects')
    .update(update)
    .eq('collection_mint', mint)
    .select(ADMIN_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Project not found')
  return mapRow(data as Record<string, unknown>)
}

export async function suggestPlatformProjectsPublic(query: string, limit = 8): Promise<PlatformProjectPublic[]> {
  const q = query.trim()
  const cap = Math.min(Math.max(1, limit), 24)
  const sb = getSupabaseAdmin()

  if (!q) {
    const { data, error } = await sb
      .from('platform_projects')
      .select(PUBLIC_COLUMNS)
      .order('raffle_count', { ascending: false })
      .order('last_seen_at', { ascending: false })
      .limit(cap)
    if (error) throw new Error(error.message)
    return (data ?? []).map((r) => toPublic(mapRow(r as Record<string, unknown>)))
  }

  const mintHit = sanitizeLaunchMintPubkey(q)
  if (mintHit) {
    const exact = await getPlatformProjectByMint(mintHit)
    return exact ? [toPublic(exact)] : []
  }

  const sanitized = q.replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64)
  if (!sanitized) return []
  const pattern = `%${sanitized}%`
  const { data, error } = await sb
    .from('platform_projects')
    .select(PUBLIC_COLUMNS)
    .ilike('display_name', pattern)
    .order('raffle_count', { ascending: false })
    .limit(cap)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => toPublic(mapRow(r as Record<string, unknown>)))
}

export async function insertPlatformProjectManual(input: {
  collectionMint: string
  displayName?: string | null
  imageUrl?: string | null
  twitterHandle?: string | null
}): Promise<PlatformProjectRow> {
  const collectionMint = sanitizeLaunchMintPubkey(input.collectionMint)
  if (!collectionMint) throw new Error('collection_mint must be a valid Solana address')
  const existing = await getPlatformProjectByMint(collectionMint)
  if (existing) return existing
  const displayName = input.displayName?.trim() || 'Unknown collection'
  const slug = slugifyPlatformProject(displayName, collectionMint)
  const now = new Date().toISOString()
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('platform_projects')
    .insert({
      collection_mint: collectionMint,
      slug,
      display_name: displayName,
      image_url: input.imageUrl?.trim() || null,
      twitter_handle: input.twitterHandle?.trim() || null,
      raffle_count: 0,
      first_seen_at: now,
      last_seen_at: now,
      last_host_wallet: null,
      outreach_status: 'none',
      notes: null,
      tags: [],
    })
    .select(ADMIN_COLUMNS)
    .single()
  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const again = await getPlatformProjectByMint(collectionMint)
      if (again) return again
    }
    throw new Error(error.message)
  }
  return mapRow(data as Record<string, unknown>)
}
