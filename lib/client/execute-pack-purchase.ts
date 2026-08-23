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

export async function executePackPurchase(
  opts: ExecutePackPurchaseOptions
): Promise<{ ok: true; result: PackOpenClientResult } | { ok: false; error: string }> {
  const wallet = opts.publicKey.toBase58()

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
    return { ok: false, error: e instanceof Error ? e.message : 'Payment cancelled' }
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
