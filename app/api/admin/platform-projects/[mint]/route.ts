import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  PLATFORM_PROJECT_OUTREACH_STATUSES,
  getPlatformProjectByMint,
  updatePlatformProjectCrm,
  type PlatformProjectOutreachStatus,
} from '@/lib/db/platform-projects'
import { sanitizeLaunchMintPubkey } from '@/lib/solana/validate-pubkey'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

function mintFromParams(params: { mint: string }): string | null {
  return sanitizeLaunchMintPubkey(decodeURIComponent(params.mint ?? ''))
}

/**
 * PATCH /api/admin/platform-projects/[mint]
 * Body: { display_name?, notes?, outreach_status?, tags?, twitter_handle? }
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ mint: string }> }) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const mint = mintFromParams(params)
    if (!mint) {
      return NextResponse.json({ error: 'Invalid collection mint in path' }, { status: 400 })
    }

    const existing = await getPlatformProjectByMint(mint)
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const patch: {
      display_name?: string
      notes?: string | null
      outreach_status?: PlatformProjectOutreachStatus
      tags?: string[]
      twitter_handle?: string | null
    } = {}

    if ('display_name' in body) {
      if (typeof body.display_name !== 'string') {
        return NextResponse.json({ error: 'display_name must be a string' }, { status: 400 })
      }
      patch.display_name = body.display_name
    }
    if ('notes' in body) {
      if (body.notes !== null && typeof body.notes !== 'string') {
        return NextResponse.json({ error: 'notes must be a string or null' }, { status: 400 })
      }
      patch.notes = body.notes
    }
    if ('outreach_status' in body) {
      const raw = typeof body.outreach_status === 'string' ? body.outreach_status.trim() : ''
      if (!(PLATFORM_PROJECT_OUTREACH_STATUSES as readonly string[]).includes(raw)) {
        return NextResponse.json(
          { error: 'outreach_status must be none, watchlist, contacted, or skip' },
          { status: 400 }
        )
      }
      patch.outreach_status = raw as PlatformProjectOutreachStatus
    }
    if ('tags' in body) {
      if (Array.isArray(body.tags)) {
        patch.tags = body.tags.filter((t: unknown): t is string => typeof t === 'string')
      } else if (typeof body.tags === 'string') {
        patch.tags = body.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      } else if (body.tags === null) {
        patch.tags = []
      } else {
        return NextResponse.json({ error: 'tags must be a string, string[], or null' }, { status: 400 })
      }
    }
    if ('twitter_handle' in body) {
      if (body.twitter_handle !== null && typeof body.twitter_handle !== 'string') {
        return NextResponse.json({ error: 'twitter_handle must be a string or null' }, { status: 400 })
      }
      patch.twitter_handle = body.twitter_handle
    }

    const project = await updatePlatformProjectCrm(mint, patch)
    return NextResponse.json({ project })
  } catch (error) {
    console.error('[admin/platform-projects PATCH]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
