import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'
import {
  syncBatchClaimLedgerAfterPayout,
  type ClaimLedgerSyncItem,
} from '@/lib/nesting/reconcile-batch-claim-ledger'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

function parseItems(body: unknown): ClaimLedgerSyncItem[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { claims?: unknown }).claims)) {
    return []
  }
  const out: ClaimLedgerSyncItem[] = []
  for (const raw of (body as { claims: unknown[] }).claims) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const position_id = typeof row.position_id === 'string' ? row.position_id.trim() : ''
    const amount = Number(row.amount ?? row.claimed)
    const claimed_rewards_total = Number(row.claimed_rewards_total)
    if (!STAKING_UUID_RE.test(position_id)) continue
    if (!Number.isFinite(amount) || amount <= 0) continue
    if (!Number.isFinite(claimed_rewards_total) || claimed_rewards_total < 0) continue
    out.push({ position_id, amount, claimed_rewards_total })
  }
  return out
}

/**
 * POST /api/me/staking/claim-ledger-sync
 * Replays nest ledger rows after OWL was already sent (Claim-all ledger sync recovery).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => null)
    const transaction_signature =
      typeof body?.transaction_signature === 'string' ? body.transaction_signature.trim() : ''
    const items = parseItems(body)

    if (!transaction_signature) {
      return NextResponse.json({ error: 'transaction_signature is required' }, { status: 400 })
    }
    if (items.length === 0) {
      return NextResponse.json({ error: 'claims array is required' }, { status: 400 })
    }

    const result = await syncBatchClaimLedgerAfterPayout({
      wallet: session.wallet,
      transaction_signature,
      items,
    })

    return NextResponse.json({
      ok: true,
      method: result.method,
      recorded_count: result.recorded_count,
    })
  } catch (e) {
    console.error('[me/staking/claim-ledger-sync]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
