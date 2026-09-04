import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getRaffleById, getRaffleBySlug, updateRaffle } from '@/lib/db/raffles'
import { sanitizeRaffleSlug } from '@/lib/raffles/slugify'
import { canonicalRaffleSlug } from '@/lib/raffles/slug-aliases'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/raffles/[id]/rename-slug
 * Full admin: rename a raffle's public slug (e.g. legendary-dumpster-14 → dumpster-14).
 *
 * Body: { slug?: string, useCanonicalAlias?: boolean }
 * - If `useCanonicalAlias` is true, uses `canonicalRaffleSlug(current)` when mapped.
 * - Otherwise `slug` is required and sanitized (phishing tokens stripped).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(id.trim())
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    let nextSlug: string
    if (body?.useCanonicalAlias === true) {
      nextSlug = sanitizeRaffleSlug(canonicalRaffleSlug(raffle.slug))
    } else if (typeof body?.slug === 'string' && body.slug.trim()) {
      nextSlug = sanitizeRaffleSlug(body.slug)
    } else {
      return NextResponse.json(
        { error: 'Provide slug or set useCanonicalAlias: true' },
        { status: 400 }
      )
    }

    if (nextSlug === raffle.slug) {
      return NextResponse.json({
        ok: true,
        unchanged: true,
        id: raffle.id,
        slug: raffle.slug,
      })
    }

    const taken = await getRaffleBySlug(nextSlug)
    if (taken && taken.id !== raffle.id) {
      return NextResponse.json(
        { error: `Slug "${nextSlug}" is already used by another raffle` },
        { status: 409 }
      )
    }

    const updated = await updateRaffle(raffle.id, { slug: nextSlug })
    return NextResponse.json({
      ok: true,
      id: raffle.id,
      previousSlug: raffle.slug,
      slug: updated.slug,
    })
  } catch (e) {
    console.error('[admin/raffles/rename-slug]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Rename failed' },
      { status: 500 }
    )
  }
}
