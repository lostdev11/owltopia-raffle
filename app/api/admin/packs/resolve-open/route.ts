import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { adminResolvePackOpenByPaymentSignature } from '@/lib/packs/admin-resolve-open'
import { packRevealMessage } from '@/lib/packs/reveal-message'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** POST /api/admin/packs/resolve-open — pay stored prize or record manual refund/payout tx. */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => ({}))
    const paymentSignature =
      typeof body.paymentSignature === 'string' ? body.paymentSignature.trim() : ''
    const action = body.action === 'record_manual' ? 'record_manual' : 'payout'

    if (!paymentSignature) {
      return NextResponse.json({ error: 'paymentSignature is required' }, { status: 400 })
    }

    if (action === 'record_manual') {
      const payoutSignature =
        typeof body.payoutSignature === 'string' ? body.payoutSignature.trim() : ''
      const resolution = body.resolution === 'refund' ? 'refund' : 'prize_paid'
      if (!payoutSignature) {
        return NextResponse.json({ error: 'payoutSignature is required' }, { status: 400 })
      }
      const result = await adminResolvePackOpenByPaymentSignature({
        paymentSignature,
        action: 'record_manual',
        payoutSignature,
        resolution,
      })
      return NextResponse.json({
        ok: true,
        result: {
          ...result,
          revealMessage: packRevealMessage({
            category: result.category,
            prizeLabel: result.prizeLabel,
            isJackpotWin: result.isJackpotWin,
          }),
        },
      })
    }

    const result = await adminResolvePackOpenByPaymentSignature({
      paymentSignature,
      action: 'payout',
    })
    return NextResponse.json({
      ok: true,
      result: {
        ...result,
        revealMessage: packRevealMessage({
          category: result.category,
          prizeLabel: result.prizeLabel,
          isJackpotWin: result.isJackpotWin,
        }),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Resolve failed'
    console.error('[admin packs] resolve-open', e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
