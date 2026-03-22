import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DISABLED_MESSAGE =
  'Image uploads are disabled. Listing images come from the prize NFT metadata when the raffle is created.'

/** User uploads are not accepted (moderation / abuse). Endpoint kept so old clients get a clear error. */
export async function POST() {
  return NextResponse.json({ error: DISABLED_MESSAGE }, { status: 403 })
}
