import { Connection, PublicKey } from '@solana/web3.js'
import { NextRequest, NextResponse } from 'next/server'

import { buildGen2PresalePaymentTransaction } from '@/lib/gen2-presale/build-transaction'
import { getGen2PresaleServerConfig } from '@/lib/gen2-presale/config'
import { getBalanceByWallet, sumConfirmedPresaleSold } from '@/lib/gen2-presale/db'
import {
  GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE,
  gen2PresaleCreditsRemainingForWallet,
} from '@/lib/gen2-presale/max-per-purchase'
import { getGen2PresaleSettings } from '@/lib/db/gen2-presale-settings'
import { computePurchaseLamports } from '@/lib/gen2-presale/pricing'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-create-tx:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const settings = await getGen2PresaleSettings()
    if (!settings.is_live) {
      return NextResponse.json(
        { error: 'Gen2 presale is not live yet.', code: 'presale_not_live' },
        { status: 403 }
      )
    }

    let body: { buyerWallet?: string; quantity?: number }
    try {
      body = (await request.json()) as { buyerWallet?: string; quantity?: number }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const buyerNorm = normalizeSolanaWalletAddress(typeof body.buyerWallet === 'string' ? body.buyerWallet : '')
    if (!buyerNorm) {
      return NextResponse.json({ error: 'Invalid buyer wallet' }, { status: 400 })
    }

    const qty = Number(body.quantity)
    if (
      !Number.isFinite(qty) ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE
    ) {
      return NextResponse.json(
        {
          error: `quantity must be an integer between 1 and ${GEN2_PRESALE_MAX_SPOTS_PER_PURCHASE}`,
        },
        { status: 400 }
      )
    }

    const bal = await getBalanceByWallet(buyerNorm)
    const walletRemaining = gen2PresaleCreditsRemainingForWallet(bal)
    if (walletRemaining <= 0) {
      return NextResponse.json(
        {
          error: 'This wallet already has the maximum Gen2 presale credits.',
          code: 'wallet_cap',
        },
        { status: 409 }
      )
    }
    if (qty > walletRemaining) {
      return NextResponse.json(
        {
          error: `You can buy at most ${walletRemaining} more spot(s) on this wallet (20 credit cap).`,
          code: 'wallet_cap',
          wallet_remaining: walletRemaining,
        },
        { status: 409 }
      )
    }

    let cfg
    try {
      cfg = await getGen2PresaleServerConfig()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Server configuration error'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const sold = await sumConfirmedPresaleSold()
    const remaining = cfg.presaleSupply - sold
    if (remaining <= 0) {
      return NextResponse.json({ error: 'Presale sold out', code: 'sold_out' }, { status: 409 })
    }
    if (qty > remaining) {
      return NextResponse.json(
        { error: `Only ${remaining} presale spots remaining`, code: 'insufficient_supply', remaining },
        { status: 409 }
      )
    }

    const breakdown = computePurchaseLamports(cfg, qty)
    const buyerPk = new PublicKey(buyerNorm)

    const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
    const built = await buildGen2PresalePaymentTransaction({
      connection,
      buyer: buyerPk,
      breakdown,
      founderA: cfg.founderA,
      founderB: cfg.founderB,
    })

    return NextResponse.json({
      transaction: built.serializedBase64,
      recentBlockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
      expected: {
        buyerWallet: buyerNorm,
        quantity: qty,
        unitPriceUsdc: breakdown.unitPriceUsdc,
        solUsdPriceUsed: breakdown.solUsdPrice,
        unitLamports: breakdown.unitLamports.toString(),
        totalLamports: breakdown.totalLamports.toString(),
        founderALamports: breakdown.founderALamports.toString(),
        founderBLamports: breakdown.founderBLamports.toString(),
        founderA: cfg.founderA.toBase58(),
        founderB: cfg.founderB.toBase58(),
      },
    })
  } catch (error) {
    console.error('gen2-presale create-transaction:', error)
    return NextResponse.json({ error: 'Failed to build transaction' }, { status: 500 })
  }
}
