'use client'

import {
  Transaction,
  VersionedTransaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  type Connection,
} from '@solana/web3.js'
import type { SendTransactionOptions } from '@solana/wallet-adapter-base'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import {
  friendlyPackPaymentError,
  insufficientPackSolMessage,
  isPackPriceMismatch,
  packPaymentLamportsNeeded,
  packPriceMismatchMessage,
} from '@/lib/packs/pack-purchase-errors'

export type PackOpenClientResult = {
  openId: string
  category: string
  prizeLabel: string
  owlAmount: number | null
  solAmount: number | null
  nftMint: string | null
  nftName: string | null
  nftImageUrl: string | null
  freeTicketCredits: number
  payoutSignature: string | null
  openSeed: string
  openCommitHash: string
  revealMessage: string
  isJackpotWin?: boolean
  jackpotAmountSol?: number | null
  jackpotPoolSol?: number | null
}

export type ExecutePackPurchaseOptions = {
  publicKey: PublicKey
  connection: Connection
  sendTransaction: (
    tx: Transaction | VersionedTransaction,
    c: Connection,
    opts?: SendTransactionOptions
  ) => Promise<string>
  /**
   * Price shown on the packs page. Used to pre-check balance before creating a
   * pending open, and to catch UI vs checkout price drift.
   */
  expectedPriceSol?: number
  /** Fires after on-chain payment confirms — UI may show “resolving prize…” here. */
  onPaymentConfirmed?: (info: {
    openId: string
    paymentSignature: string
  }) => void
}

async function confirmPackOpen(input: {
  openId: string
  wallet: string
  paymentSignature: string
}): Promise<{ ok: true; result: PackOpenClientResult } | { ok: false; error: string }> {
  const openRes = await fetch('/api/packs/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      openId: input.openId,
      wallet: input.wallet,
      paymentSignature: input.paymentSignature,
    }),
  })
  const openData = await openRes.json().catch(() => ({}))
  if (!openRes.ok) {
    return { ok: false, error: openData.error || 'Pack open failed after payment' }
  }
  return { ok: true, result: openData.result as PackOpenClientResult }
}

async function readBalanceLamports(
  connection: Connection,
  publicKey: PublicKey
): Promise<number | null> {
  try {
    return await connection.getBalance(publicKey, 'confirmed')
  } catch {
    // Never block purchase solely because balance RPC failed — wallet/preflight still runs.
    return null
  }
}

export async function executePackPurchase(
  opts: ExecutePackPurchaseOptions
): Promise<{ ok: true; result: PackOpenClientResult } | { ok: false; error: string }> {
  const wallet = opts.publicKey.toBase58()
  let balanceLamports = await readBalanceLamports(opts.connection, opts.publicKey)
  const expectedPriceSol =
    opts.expectedPriceSol && opts.expectedPriceSol > 0 ? opts.expectedPriceSol : null

  // Fail fast before create so we do not leave stranded pending_payment rows.
  if (expectedPriceSol != null && balanceLamports != null) {
    const needed = packPaymentLamportsNeeded(expectedPriceSol)
    if (balanceLamports < needed) {
      return {
        ok: false,
        error: insufficientPackSolMessage({
          priceSol: expectedPriceSol,
          balanceLamports,
        }),
      }
    }
  }

  const createRes = await fetch('/api/packs/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet }),
  })
  const createData = await createRes.json().catch(() => ({}))
  if (!createRes.ok) {
    return { ok: false, error: createData.error || 'Could not start pack open' }
  }

  const openId = createData.openId as string
  const priceSol = Number(createData.priceSol)
  const vault = createData.vault as string
  if (!openId || !vault || !(priceSol > 0)) {
    return { ok: false, error: 'Invalid pack create response' }
  }

  if (expectedPriceSol != null && isPackPriceMismatch(expectedPriceSol, priceSol)) {
    return { ok: false, error: packPriceMismatchMessage(expectedPriceSol, priceSol) }
  }

  // Re-check against the charged price (create is source of truth).
  if (balanceLamports == null) {
    balanceLamports = await readBalanceLamports(opts.connection, opts.publicKey)
  }
  if (balanceLamports != null) {
    const needed = packPaymentLamportsNeeded(priceSol)
    if (balanceLamports < needed) {
      return {
        ok: false,
        error: insufficientPackSolMessage({
          priceSol,
          balanceLamports,
        }),
      }
    }
  }

  const lamports = Math.round(priceSol * LAMPORTS_PER_SOL)
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: opts.publicKey,
      toPubkey: new PublicKey(vault),
      lamports,
    })
  )

  let signature: string
  try {
    signature = await opts.sendTransaction(tx, opts.connection, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
  } catch (e) {
    return {
      ok: false,
      error: friendlyPackPaymentError(e, {
        priceSol,
        balanceLamports: balanceLamports ?? undefined,
      }),
    }
  }

  try {
    await confirmSignatureSuccessOnChain(opts.connection, signature)
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : 'Payment sent but confirmation timed out — contact support with your signature',
    }
  }

  opts.onPaymentConfirmed?.({ openId, paymentSignature: signature })

  return confirmPackOpen({
    openId,
    wallet,
    paymentSignature: signature,
  })
}
