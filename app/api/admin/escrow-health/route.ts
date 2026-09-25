import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import {
  getPrizeEscrowKeypair,
  getPrizeEscrowPublicKey,
  isPrizeEscrowFrozenSplVerifyBypassEnabled,
} from '@/lib/raffles/prize-escrow'
import { getFundsEscrowKeypair, getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { getVrfFeePayerKeypair, getVrfFeePayerPublicKey } from '@/lib/raffles/vrf-fee-payer'
import { loadFundsEscrowLiabilityWithCoverage } from '@/lib/raffles/funds-escrow-liability-service'
import { loadPrizeEscrowSolLiabilityWithCoverage } from '@/lib/raffles/prize-escrow-sol-liability-service'
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

function envKeyMeta(raw: string) {
  return {
    envPresent: raw.length > 0,
    envLooksJsonArray: raw.startsWith('[') && raw.endsWith(']'),
    envLength: raw.length,
  }
}

/**
 * GET /api/admin/escrow-health
 * Full-admin only. Prize escrow SOL liability + funds escrow liability + VRF fee payer config.
 * Used to debug pending deposits / claim-proceeds / SOL prize shortfalls without leaking secrets.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const prizeRaw = process.env.PRIZE_ESCROW_SECRET_KEY?.trim() ?? ''
    const fundsRaw = process.env.FUNDS_ESCROW_SECRET_KEY?.trim() ?? ''
    const vrfRaw = process.env.VRF_FEE_PAYER_SECRET_KEY?.trim() ?? ''
    const prizeKeypair = getPrizeEscrowKeypair()
    const prizeAddress = getPrizeEscrowPublicKey()
    const fundsKeypair = getFundsEscrowKeypair()
    const fundsAddress = getFundsEscrowPublicKey()
    const vrfKeypair = getVrfFeePayerKeypair()
    const vrfAddress = getVrfFeePayerPublicKey()

    const rpcUrl = resolveServerSolanaRpcUrl()
    const cluster = /devnet/i.test(rpcUrl) ? 'devnet' : 'mainnet'

    let fundsLiability: Awaited<ReturnType<typeof loadFundsEscrowLiabilityWithCoverage>> | null =
      null
    let fundsLiabilityError: string | null = null
    try {
      fundsLiability = await loadFundsEscrowLiabilityWithCoverage()
    } catch (e) {
      fundsLiabilityError = e instanceof Error ? e.message : String(e)
    }

    let prizeSolLiability: Awaited<
      ReturnType<typeof loadPrizeEscrowSolLiabilityWithCoverage>
    > | null = null
    let prizeSolLiabilityError: string | null = null
    try {
      prizeSolLiability = await loadPrizeEscrowSolLiabilityWithCoverage()
    } catch (e) {
      prizeSolLiabilityError = e instanceof Error ? e.message : String(e)
    }

    return NextResponse.json({
      ok: true,
      viewer: session.wallet,
      escrow: {
        configured: Boolean(prizeKeypair && prizeAddress),
        publicKey: prizeAddress,
        ...envKeyMeta(prizeRaw),
        solLiability: prizeSolLiability
          ? {
              covered: prizeSolLiability.coverage.covered,
              shortfallSol: prizeSolLiability.coverage.shortfallSol,
              error: prizeSolLiability.coverage.error,
              requiredSol: prizeSolLiability.liability.requiredSol,
              buckets: prizeSolLiability.liability.buckets,
              counts: prizeSolLiability.liability.counts,
              hold: {
                nativeSol: prizeSolLiability.pool.nativeSol,
                wsolSol: prizeSolLiability.pool.wsolSol,
              },
              feeReserveSol: prizeSolLiability.feeReserveSol,
            }
          : null,
        solLiabilityError: prizeSolLiabilityError,
      },
      fundsEscrow: {
        configured: Boolean(fundsKeypair && fundsAddress),
        publicKey: fundsAddress,
        ...envKeyMeta(fundsRaw),
        liability: fundsLiability
          ? {
              covered: fundsLiability.coverage.covered,
              shortfall: fundsLiability.coverage.shortfall,
              error: fundsLiability.coverage.error,
              required: fundsLiability.liability.required,
              buckets: fundsLiability.liability.buckets,
              counts: fundsLiability.liability.counts,
              hold: {
                sol: fundsLiability.pool.sol,
                usdc: fundsLiability.pool.usdc,
                owl: fundsLiability.pool.owl,
                bamboo: fundsLiability.pool.bamboo,
                goats: fundsLiability.pool.goats,
              },
              feeReserveSol: fundsLiability.feeReserveSol,
            }
          : null,
        liabilityError: fundsLiabilityError,
      },
      vrfFeePayer: {
        configured: Boolean(vrfKeypair && vrfAddress),
        publicKey: vrfAddress,
        ...envKeyMeta(vrfRaw),
        note: vrfAddress
          ? 'Preferred Switchboard / reveal memo fee payer'
          : 'Unset — falls back to funds escrow only (never prize escrow; SOL prizes share that wallet)',
      },
      frozenSplDepositVerifyBypass: {
        enabled: isPrizeEscrowFrozenSplVerifyBypassEnabled(),
        strictEnv: Boolean(process.env.PRIZE_ESCROW_STRICT_FROZEN_SPL_VERIFY?.trim()),
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
