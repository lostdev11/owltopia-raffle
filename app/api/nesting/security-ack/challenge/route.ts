import { NextRequest, NextResponse } from 'next/server'
import { Connection } from '@solana/web3.js'

import {
  buildNestingSecurityAckMessage,
  generateNestingSecurityAckNonce,
} from '@/lib/nesting/security-ack-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveServerSolanaReadRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'

const CHALLENGE_IP_LIMIT = 45
const CHALLENGE_WALLET_LIMIT = 25
const CHALLENGE_WINDOW_MS = 60_000

/**
 * GET /api/nesting/security-ack/challenge?wallet=<address>
 * Returns a message the connected wallet must sign before opening a new nest.
 * Also returns a recent blockhash for Ledger memo-tx fallback (signTransaction, not broadcast).
 */
export async function GET(request: NextRequest) {
  try {
    const walletRaw = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    const wallet = normalizeSolanaWalletAddress(walletRaw)
    if (!wallet) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const ipRl = rateLimit(`nesting-ack-challenge:ip:${ip}`, CHALLENGE_IP_LIMIT, CHALLENGE_WINDOW_MS)
    if (!ipRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }
    const walletRl = rateLimit(`nesting-ack-challenge:wallet:${wallet}`, CHALLENGE_WALLET_LIMIT, CHALLENGE_WINDOW_MS)
    if (!walletRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const nonce = generateNestingSecurityAckNonce(wallet, expiresAt.getTime())
    const message = buildNestingSecurityAckMessage(wallet, nonce, expiresAt)

    let blockhash: string | null = null
    let lastValidBlockHeight: number | null = null
    try {
      const connection = new Connection(resolveServerSolanaReadRpcUrl(), 'confirmed')
      const latest = await connection.getLatestBlockhash('confirmed')
      blockhash = latest.blockhash
      lastValidBlockHeight = latest.lastValidBlockHeight
    } catch (e) {
      console.warn(
        '[nesting/security-ack/challenge] blockhash for Ledger tx fallback unavailable:',
        e instanceof Error ? e.message : e
      )
    }

    return NextResponse.json({
      wallet,
      message,
      expiresAt: expiresAt.toISOString(),
      blockhash,
      lastValidBlockHeight,
      txFallback: true,
    })
  } catch (e) {
    console.error('[nesting/security-ack/challenge]', e)
    return NextResponse.json({ error: 'Failed to create acknowledgment challenge' }, { status: 500 })
  }
}
