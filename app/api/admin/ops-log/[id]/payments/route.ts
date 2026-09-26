import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { parseCreateAdminOpsLogPaymentBody } from '@/lib/admin-ops-log/parse-payment-body'
import {
  adminOpsLogEntryExists,
  createAdminOpsLogPayment,
  findDuplicateOpsLogTxSignature,
  listAdminOpsLogPayments,
} from '@/lib/db/admin-ops-log-payments'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/ops-log/[id]/payments — list payments for an entry (mod + full).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await params
    if (!id?.trim()) {
      return NextResponse.json({ error: 'Entry id required' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-ops-log-payments-list:${ip}:${session.wallet}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const exists = await adminOpsLogEntryExists(id)
    if (!exists) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    const payments = await listAdminOpsLogPayments(id)
    return NextResponse.json({ payments })
  } catch (e) {
    console.error('[admin/ops-log payments GET]', e)
    const msg = safeErrorMessage(e)
    if (msg.toLowerCase().includes('admin_ops_log_payments') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Table missing. Run migration 254_admin_ops_log_payments.sql.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/admin/ops-log/[id]/payments — add payment (mod + full).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await params
    if (!id?.trim()) {
      return NextResponse.json({ error: 'Entry id required' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-ops-log-payments-create:${ip}:${session.wallet}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const exists = await adminOpsLogEntryExists(id)
    if (!exists) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = parseCreateAdminOpsLogPaymentBody(body, id, session.wallet)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    let duplicateWarning: string | undefined
    if (parsed.params.txSignature) {
      const dup = await findDuplicateOpsLogTxSignature(parsed.params.txSignature, {
        excludeEntryId: id,
      })
      if (dup) {
        duplicateWarning = `This tx signature is already logged on ops log entry ${dup.entry_id}.`
      }
    }

    const payment = await createAdminOpsLogPayment(parsed.params)
    if (!payment) {
      return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 })
    }

    return NextResponse.json({
      payment,
      ...(duplicateWarning ? { warning: duplicateWarning } : {}),
    })
  } catch (e) {
    console.error('[admin/ops-log payments POST]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
