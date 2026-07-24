import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { isAdmin } from '@/lib/db/admins'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { descriptionContainsBlockedLinks } from '@/lib/raffle-description-links'
import { safeErrorMessage } from '@/lib/safe-error'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

const DESCRIPTION_MAX_CHARS = 5000

/**
 * PATCH /api/raffles/[id]/description
 * Raffle creator or admin can update description only.
 * Non-admins cannot include links/URLs (same rule as create).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const sessionIsAdmin = await isAdmin(session.wallet)
    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator =
      !!creatorWallet && walletsEqualSolana(creatorWallet, session.wallet)
    if (!sessionIsAdmin && !isCreator) {
      return NextResponse.json(
        { error: 'Only the raffle creator or an admin can edit the description' },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || !('description' in body)) {
      return NextResponse.json(
        { error: 'description is required (string or null)' },
        { status: 400 }
      )
    }

    const raw = (body as { description: unknown }).description
    let description: string | null
    if (raw === null) {
      description = null
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      description = trimmed.length > 0 ? trimmed : null
    } else {
      return NextResponse.json(
        { error: 'description must be a string or null' },
        { status: 400 }
      )
    }

    if (description && description.length > DESCRIPTION_MAX_CHARS) {
      return NextResponse.json(
        { error: `Description must be at most ${DESCRIPTION_MAX_CHARS} characters` },
        { status: 400 }
      )
    }

    if (!sessionIsAdmin && descriptionContainsBlockedLinks(description)) {
      return NextResponse.json(
        {
          error:
            'Descriptions cannot include links or web addresses. Remove URLs, domains (e.g. example.com), IP addresses, Discord/Telegram invites, and markdown links.',
        },
        { status: 400 }
      )
    }

    const updated = await updateRaffle(id, { description })
    if (!updated) {
      return NextResponse.json({ error: 'Failed to update description' }, { status: 500 })
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error('[PATCH /api/raffles/[id]/description]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
