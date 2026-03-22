import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DISABLED_MESSAGE =
  'Image uploads are disabled. Listing images come from the prize NFT metadata when the raffle is created.'

/** Replacement uploads are not accepted. Endpoint kept so old clients get a clear error. */
export async function POST() {
  return NextResponse.json({ error: DISABLED_MESSAGE }, { status: 403 })
}
