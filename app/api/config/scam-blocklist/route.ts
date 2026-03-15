import { NextResponse } from 'next/server'
import { getScamBlocklist } from '@/lib/scam-blocklist'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/config/scam-blocklist
 * Returns list of blocked addresses (mints + collection addresses) for scam/spam NFT filtering.
 * Client uses this to filter out scam NFTs when loading wallet NFTs via RPC.
 */
export async function GET() {
  try {
    const set = await getScamBlocklist()
    return NextResponse.json({ addresses: Array.from(set) })
  } catch {
    return NextResponse.json({ addresses: [] })
  }
}
