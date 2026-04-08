import { NextRequest, NextResponse } from 'next/server'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

function retired() {
  return NextResponse.json(
    { error: 'NFT giveaways have been retired. Use Community pool giveaways instead.' },
    { status: 410 }
  )
}

/**
 * PATCH /api/admin/nft-giveaways/[id]
 * Update metadata before deposit verify or claim. Cannot change mint/eligible after claim.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    void request
    void context
    return retired()
  } catch (error) {
    console.error('[admin/nft-giveaways PATCH]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
