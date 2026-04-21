/**
 * Owl Council — Supabase-backed proposals and votes (no RPC / Helius in this module).
 */

import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import type { OwlVoteChoice } from '@/lib/council/vote-types'
import { getCouncilProposalWindowError } from '@/lib/council/owl-proposal-rules'

export type OwlProposalStatus = 'draft' | 'active' | 'ended' | 'archived'

export type OwlProposalRow = {
  id: string
  title: string
  slug: string
  summary: string
  description: string
  status: OwlProposalStatus
  start_time: string
  end_time: string
  created_by: string
  created_at: string
  updated_at: string
}

export type OwlVoteBucket = 'active' | 'upcoming' | 'past' | 'all'

export type OwlVoteTotals = {
  yes: number
  no: number
  abstain: number
}

function db() {
  return getSupabaseForServerRead(supabase)
}

function isPublishedRow(row: OwlProposalRow): boolean {
  return row.status === 'active' || row.status === 'ended' || row.status === 'archived'
}

function matchesBucket(row: OwlProposalRow, bucket: OwlVoteBucket, nowMs: number): boolean {
  if (!isPublishedRow(row)) return false
  const startMs = new Date(row.start_time).getTime()
  const endMs = new Date(row.end_time).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false

  if (bucket === 'all') return true

  if (bucket === 'active') {
    return row.status === 'active' && startMs <= nowMs && endMs >= nowMs
  }
  if (bucket === 'upcoming') {
    return row.status === 'active' && startMs > nowMs
  }
  // past
  return endMs < nowMs || row.status === 'ended' || row.status === 'archived'
}

/**
 * Published proposals only (no drafts). Filtered in memory after fetch — OK for scaffold volumes.
 */
export async function listPublishedOwlProposals(
  bucket: OwlVoteBucket,
  opts?: { limit?: number }
): Promise<OwlProposalRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 80, 1), 200)
  const nowMs = Date.now()

  const { data, error } = await db()
    .from('owl_proposals')
    .select(
      'id, title, slug, summary, description, status, start_time, end_time, created_by, created_at, updated_at'
    )
    .in('status', ['active', 'ended', 'archived'])
    .order('start_time', { ascending: false })
    .limit(500)

  if (error) {
    console.error('[owl-council] listPublishedOwlProposals:', error.message)
    return []
  }

  const rows = (data ?? []) as OwlProposalRow[]
  const filtered = bucket === 'all' ? rows : rows.filter((r) => matchesBucket(r, bucket, nowMs))
  return filtered.slice(0, limit)
}

export async function getPublishedOwlProposalBySlug(slug: string): Promise<OwlProposalRow | null> {
  const s = slug.trim()
  if (!s) return null

  const { data, error } = await db()
    .from('owl_proposals')
    .select(
      'id, title, slug, summary, description, status, start_time, end_time, created_by, created_at, updated_at'
    )
    .eq('slug', s)
    .maybeSingle()

  if (error) {
    console.error('[owl-council] getPublishedOwlProposalBySlug:', error.message)
    return null
  }

  const row = data as OwlProposalRow | null
  if (!row || !isPublishedRow(row)) return null
  return row
}

export async function sumVoteTotalsForProposal(proposalId: string): Promise<OwlVoteTotals> {
  const empty: OwlVoteTotals = { yes: 0, no: 0, abstain: 0 }
  if (!proposalId) return empty

  const { data, error } = await db()
    .from('owl_votes')
    .select('vote_choice, voting_power')
    .eq('proposal_id', proposalId)

  if (error) {
    console.error('[owl-council] sumVoteTotalsForProposal:', error.message)
    return empty
  }

  const totals = { ...empty }
  for (const raw of data ?? []) {
    const choice = (raw as { vote_choice?: string; voting_power?: string | number }).vote_choice
    const rawPower = (raw as { voting_power?: string | number }).voting_power
    const power =
      typeof rawPower === 'string'
        ? Number.parseFloat(rawPower)
        : Number(rawPower !== undefined && rawPower !== null ? rawPower : 1)
    const w = Number.isFinite(power) ? power : 0
    if (choice === 'yes') totals.yes += w
    else if (choice === 'no') totals.no += w
    else if (choice === 'abstain') totals.abstain += w
  }
  return totals
}

/**
 * Vote totals for many proposals in one query (landing cards).
 */
export async function sumVoteTotalsForManyProposals(ids: string[]): Promise<Map<string, OwlVoteTotals>> {
  const map = new Map<string, OwlVoteTotals>()
  if (ids.length === 0) return map

  const unique = [...new Set(ids)].filter(Boolean)
  for (const id of unique) {
    map.set(id, { yes: 0, no: 0, abstain: 0 })
  }

  const { data, error } = await db()
    .from('owl_votes')
    .select('proposal_id, vote_choice, voting_power')
    .in('proposal_id', unique)

  if (error || !data) {
    if (error) console.error('[owl-council] sumVoteTotalsForManyProposals:', error.message)
    return map
  }

  for (const raw of data) {
    const pid = String((raw as { proposal_id?: string }).proposal_id ?? '')
    const totals = map.get(pid)
    if (!totals) continue
    const choice = (raw as { vote_choice?: string }).vote_choice
    const rawPower = (raw as { voting_power?: string | number }).voting_power
    const power =
      typeof rawPower === 'string'
        ? Number.parseFloat(rawPower)
        : Number(rawPower !== undefined && rawPower !== null ? rawPower : 1)
    const w = Number.isFinite(power) ? power : 0
    if (choice === 'yes') totals.yes += w
    else if (choice === 'no') totals.no += w
    else if (choice === 'abstain') totals.abstain += w
  }
  return map
}

export async function getOwlVoteForWallet(
  proposalId: string,
  wallet: string
): Promise<OwlVoteChoice | null> {
  const w = wallet.trim()
  if (!proposalId || !w) return null

  const { data, error } = await db()
    .from('owl_votes')
    .select('vote_choice')
    .eq('proposal_id', proposalId)
    .eq('wallet_address', w)
    .maybeSingle()

  if (error || !data) return null
  const c = (data as { vote_choice?: string }).vote_choice
  if (c === 'yes' || c === 'no' || c === 'abstain') return c
  return null
}

export async function insertOwlVote(params: {
  proposalId: string
  wallet: string
  voteChoice: OwlVoteChoice
  /** OWL-weighted amount (decimal string recommended for NUMERIC precision). */
  votingPower: number | string
}): Promise<{ ok: true } | { ok: false; code: 'duplicate' | 'error'; message: string }> {
  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.from('owl_votes').insert({
      proposal_id: params.proposalId,
      wallet_address: params.wallet.trim(),
      vote_choice: params.voteChoice,
      voting_power: params.votingPower,
    })
    if (!error) return { ok: true }

    if (error.code === '23505') {
      return { ok: false, code: 'duplicate', message: 'Already voted on this proposal.' }
    }
    console.error('[owl-council] insertOwlVote:', error.message)
    return { ok: false, code: 'error', message: error.message || 'Could not record vote.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not record vote.'
    return { ok: false, code: 'error', message: msg }
  }
}

export async function listAllOwlProposalsForAdmin(): Promise<OwlProposalRow[]> {
  const { data, error } = await db()
    .from('owl_proposals')
    .select(
      'id, title, slug, summary, description, status, start_time, end_time, created_by, created_at, updated_at'
    )
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[owl-council] listAllOwlProposalsForAdmin:', error.message)
    return []
  }
  return (data ?? []) as OwlProposalRow[]
}

export async function getOwlProposalBySlugAny(slug: string): Promise<OwlProposalRow | null> {
  const s = slug.trim()
  if (!s) return null

  const { data, error } = await db()
    .from('owl_proposals')
    .select(
      'id, title, slug, summary, description, status, start_time, end_time, created_by, created_at, updated_at'
    )
    .eq('slug', s)
    .maybeSingle()

  if (error) {
    console.error('[owl-council] getOwlProposalBySlugAny:', error.message)
    return null
  }
  return data as OwlProposalRow | null
}

export async function createOwlProposalAdmin(fields: {
  title: string
  slug: string
  summary: string
  description: string
  status: OwlProposalStatus
  start_time: string
  end_time: string
  created_by: string
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const windowErr = getCouncilProposalWindowError(fields.start_time, fields.end_time)
  if (windowErr) {
    return { ok: false, message: windowErr }
  }

  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('owl_proposals')
      .insert({
        title: fields.title.trim(),
        slug: fields.slug.trim(),
        summary: fields.summary.trim(),
        description: fields.description.trim(),
        status: fields.status,
        start_time: fields.start_time,
        end_time: fields.end_time,
        created_by: fields.created_by.trim(),
      })
      .select('id')
      .single()

    if (!error && data?.id) {
      return { ok: true, id: String(data.id) }
    }
    const msg =
      error?.code === '23505'
        ? 'Slug already exists.'
        : error?.message || 'Could not create proposal.'
    return { ok: false, message: msg }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not create proposal.' }
  }
}

export async function updateOwlProposalBySlugAdmin(
  slug: string,
  patch: Partial<{
    title: string
    summary: string
    description: string
    status: OwlProposalStatus
    start_time: string
    end_time: string
  }>
): Promise<{ ok: true } | { ok: false; message: string }> {
  const s = slug.trim()
  if (!s) return { ok: false, message: 'Missing slug.' }

  try {
    const admin = getSupabaseAdmin()
    const row: Record<string, unknown> = {}
    if (patch.title !== undefined) row.title = patch.title.trim()
    if (patch.summary !== undefined) row.summary = patch.summary.trim()
    if (patch.description !== undefined) row.description = patch.description.trim()
    if (patch.status !== undefined) row.status = patch.status
    if (patch.start_time !== undefined) row.start_time = patch.start_time
    if (patch.end_time !== undefined) row.end_time = patch.end_time

    if (Object.keys(row).length === 0) {
      return { ok: false, message: 'No fields to update.' }
    }

    if (patch.start_time !== undefined || patch.end_time !== undefined) {
      const { data: existingRow, error: fetchErr } = await admin
        .from('owl_proposals')
        .select('start_time, end_time')
        .eq('slug', s)
        .maybeSingle()

      if (fetchErr || !existingRow) {
        return { ok: false, message: fetchErr?.message || 'Proposal not found.' }
      }

      const ex = existingRow as { start_time: string; end_time: string }
      const mergedStart = patch.start_time !== undefined ? patch.start_time : ex.start_time
      const mergedEnd = patch.end_time !== undefined ? patch.end_time : ex.end_time
      const winErr = getCouncilProposalWindowError(mergedStart, mergedEnd)
      if (winErr) {
        return { ok: false, message: winErr }
      }
    }

    const { error } = await admin.from('owl_proposals').update(row).eq('slug', s)

    if (!error) return { ok: true }
    return { ok: false, message: error.message || 'Could not update proposal.' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not update proposal.' }
  }
}
