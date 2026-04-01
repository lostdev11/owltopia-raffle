import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getPrizeEscrowKeypair,
  getPrizeEscrowPublicKey,
  getPrizeNftFreezeAuthorityPublicKey,
} from '@/lib/raffles/prize-escrow'
import { safeErrorMessage } from '@/lib/safe-error'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'

function redactUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    // Avoid leaking RPC API keys in admin tooling responses
    if (u.searchParams.has('api-key')) u.searchParams.set('api-key', 'REDACTED')
    if (u.searchParams.has('apikey')) u.searchParams.set('apikey', 'REDACTED')
    if (u.username) u.username = 'REDACTED'
    if (u.password) u.password = 'REDACTED'
    return u.toString()
  } catch {
    return url
  }
}

/**
 * GET /api/admin/escrow-health
 * Full-admin only. Returns whether prize escrow is configured and what the server believes the escrow pubkey is.
 * This is used to debug "pending escrow deposit" issues in production without leaking secrets.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const raw = process.env.PRIZE_ESCROW_SECRET_KEY?.trim() ?? ''
    const rawFreeze = process.env.PRIZE_NFT_FREEZE_AUTHORITY_SECRET_KEY?.trim() ?? ''
    const keypair = getPrizeEscrowKeypair()
    const address = getPrizeEscrowPublicKey()
    const freezeAuthPub = getPrizeNftFreezeAuthorityPublicKey()

    const rpcUrl = resolveServerSolanaRpcUrl()
    const cluster = /devnet/i.test(rpcUrl) ? 'devnet' : 'mainnet'

    return NextResponse.json({
      ok: true,
      viewer: session.wallet,
      escrow: {
        configured: Boolean(keypair && address),
        publicKey: address,
        // Useful for debugging env formatting issues (extra quotes/newlines)
        envPresent: raw.length > 0,
        envLooksJsonArray: raw.startsWith('[') && raw.endsWith(']'),
        envLength: raw.length,
      },
      // When publicKey matches mint.freezeAuthority, frozen escrow prizes can thaw+transfer in one claim tx
      nftFreezeAuthority: {
        configured: Boolean(freezeAuthPub),
        publicKey: freezeAuthPub,
        envPresent: rawFreeze.length > 0,
        envLooksJsonArray: rawFreeze.startsWith('[') && rawFreeze.endsWith(']'),
        envLength: rawFreeze.length,
      },
      solana: {
        clusterGuess: cluster,
        rpcUrl: redactUrl(rpcUrl),
        hasSolanaRpcUrl: Boolean(process.env.SOLANA_RPC_URL?.trim()),
        hasNextPublicSolanaRpcUrl: Boolean(process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()),
        hasDevSolanaRpcOverride: Boolean(
          process.env.NODE_ENV === 'development' &&
            (process.env.SOLANA_RPC_DEV_URL?.trim() || process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim())
        ),
      },
    })
  } catch (e) {
    console.error('[admin/escrow-health]', e)
    return NextResponse.json({ ok: false, error: safeErrorMessage(e) }, { status: 500 })
  }
}

