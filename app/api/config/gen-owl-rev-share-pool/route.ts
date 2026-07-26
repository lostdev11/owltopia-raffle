import { NextResponse } from 'next/server'
import { getGenOwlRevSharePoolPublicKey } from '@/lib/nesting/gen-owl-rev-share-pool'

export const dynamic = 'force-dynamic'

/**
 * GET /api/config/gen-owl-rev-share-pool
 * Public pubkey for the dedicated Gen Owl rev-share pool (when configured).
 */
export async function GET() {
  const address = getGenOwlRevSharePoolPublicKey()
  if (!address) {
    return NextResponse.json({ error: 'Rev share pool is not configured' }, { status: 503 })
  }
  return NextResponse.json({ address })
}
