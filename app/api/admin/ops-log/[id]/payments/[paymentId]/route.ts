import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { parseUpdateAdminOpsLogPaymentBody } from '@/lib/admin-ops-log/parse-payment-body'
import {
  deleteAdminOpsLogPayment,
  findDuplicateOpsLogTxSignature,
  getAdminOpsLogPaymentById,
  updateAdminOpsLogPayment,
} from '@/lib/db/admin-ops-log-payments'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/ops-log/[id]/payments/[paymentId] — edit payment (mod + full).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id, paymentId } = await params
    if (!id?.trim() || !paymentId?.trim()) {
      return NextResponse.json({ error: 'Entry id and payment id required' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-ops-log-payments-patch:${ip}:${session.wallet}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = parseUpdateAdminOpsLogPaymentBody(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    let duplicateWarning: string | undefined
    if (parsed.params.txSignature) {
      const dup = await findDuplicateOpsLogTxSignature(parsed.params.txSignature, {
        excludePaymentId: paymentId,
        excludeEntryId: id,
      })
      if (dup) {
        duplicateWarning = `This tx signature is already logged on ops log entry ${dup.entry_id}.`
      }
    }

    const payment = await updateAdminOpsLogPayment(paymentId, parsed.params)
    if (!payment) {
      return NextResponse.json({ error: 'Failed to update payment' }, { status: 500 })
    }
    if (payment.entry_id !== id) {
      return NextResponse.json({ error: 'Payment does not belong to this entry' }, { status: 404 })
    }

    return NextResponse.json({
      payment,
      ...(duplicateWarning ? { warning: duplicateWarning } : {}),
    })
  } catch (e) {
    console.error('[admin/ops-log payments PATCH]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/ops-log/[id]/payments/[paymentId] — remove payment (mod + full).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id, paymentId } = await params
    if (!id?.trim() || !paymentId?.trim()) {
      return NextResponse.json({ error: 'Entry id and payment id required' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-ops-log-payments-delete:${ip}:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const existing = await getAdminOpsLogPaymentById(paymentId)
    if (!existing) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }
    if (existing.entry_id !== id) {
      return NextResponse.json({ error: 'Payment does not belong to this entry' }, { status: 404 })
    }

    const ok = await deleteAdminOpsLogPayment(paymentId)
    if (!ok) {
      return NextResponse.json({ error: 'Failed to delete payment' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[admin/ops-log payments DELETE]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
