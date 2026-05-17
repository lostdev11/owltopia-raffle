import { NextRequest } from 'next/server'
import { handleCreateRafflePost } from '@/lib/server/raffles/handle-create-raffle-post'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** NFT-only create path: forces `sol_domains_hub` and verifies mint looks like a SNS .sol domain on-chain. */
export async function POST(request: NextRequest) {
  return handleCreateRafflePost(request, { snsDomainHubOnly: true })
}
