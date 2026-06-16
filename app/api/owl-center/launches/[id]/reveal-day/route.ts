import { NextRequest, NextResponse } from 'next/server'

import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import {
  confirmRevealDayPaymentForLaunch,
  enableRevealDayForLaunch,
  getRevealDayStatusForLaunch,
  runRevealDayForLaunch,
  scheduleRevealDayForLaunch,
} from '@/lib/owl-center/reveal-day'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  const status = await getRevealDayStatusForLaunch(id)
  if (!status) return jsonError('Launch not found', 404)

  return NextResponse.json(status)
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-creator-reveal-day:${ip}`, 12, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  let body: { action?: string; reveal_at?: string; payment_tx_signature?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const action = body.action?.trim().toLowerCase()
  if (!action) return jsonError('Missing action', 400)

  switch (action) {
    case 'enable': {
      const result = await enableRevealDayForLaunch(id)
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : 400
        return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status })
      }
      return NextResponse.json({ ok: true, launch: result.launch })
    }
    case 'confirm_payment': {
      const sig = body.payment_tx_signature?.trim()
      if (!sig) return jsonError('Missing payment_tx_signature', 400)
      const result = await confirmRevealDayPaymentForLaunch(id, sig)
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: 400 })
      }
      return NextResponse.json({ ok: true, launch: result.launch })
    }
    case 'schedule': {
      const revealAt = body.reveal_at?.trim()
      if (!revealAt) return jsonError('Missing reveal_at (ISO timestamp)', 400)
      const result = await scheduleRevealDayForLaunch(id, revealAt)
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: 400 })
      }
      return NextResponse.json({ ok: true, launch: result.launch })
    }
    case 'reveal_now': {
      const result = await runRevealDayForLaunch(id)
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: 400 })
      }
      return NextResponse.json({
        ok: true,
        refreshed_count: result.refreshed_count,
        skipped_count: result.skipped_count,
        launch: result.launch,
      })
    }
    default:
      return jsonError('Invalid action — use enable, confirm_payment, schedule, or reveal_now', 400)
  }
}
