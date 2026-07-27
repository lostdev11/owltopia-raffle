/**
 * Post an on-chain memo reveal for a completed draw (FFF-shaped transparency).
 * Best-effort: draw remains valid in DB even if this fails (no escrow key / RPC).
 */
import { Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import type { Keypair } from '@solana/web3.js'
import { SIGN_IN_MEMO_PROGRAM_ID } from '@/lib/auth-tx-sign-in'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getFundsEscrowKeypair } from '@/lib/raffles/funds-escrow'
import { getPrizeEscrowKeypair } from '@/lib/raffles/prize-escrow'
import { encodeDrawRevealMemo } from '@/lib/raffles/draw/memo'
import type { DrawRevealMemoParts } from '@/lib/raffles/draw/types'

export type SendDrawRevealResult =
  | { ok: true; signature: string; memo: string; feePayer: string }
  | { ok: false; error: string; memo: string }

function resolveRevealFeePayer(): Keypair | null {
  return getFundsEscrowKeypair() ?? getPrizeEscrowKeypair() ?? null
}

export async function sendDrawRevealMemoTransaction(
  parts: Omit<DrawRevealMemoParts, 'algo'> & { algo?: string }
): Promise<SendDrawRevealResult> {
  const memo = encodeDrawRevealMemo({
    algo: parts.algo || 'owltopia-draw-v1',
    raffleId: parts.raffleId,
    drawSeed: parts.drawSeed,
    soldCount: parts.soldCount,
    winnerIndex: parts.winnerIndex,
    ledgerHash: parts.ledgerHash,
  })

  const payer = resolveRevealFeePayer()
  if (!payer) {
    return {
      ok: false,
      error:
        'No escrow key configured to sign reveal (set FUNDS_ESCROW_SECRET_KEY or PRIZE_ESCROW_SECRET_KEY)',
      memo,
    }
  }

  try {
    const connection = getSolanaConnection()
    const tx = new Transaction()
    tx.feePayer = payer.publicKey
    tx.add(
      new TransactionInstruction({
        keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
        programId: SIGN_IN_MEMO_PROGRAM_ID,
        data: Buffer.from(memo, 'utf8'),
      })
    )
    // Tiny self-transfer keeps some explorers indexing the fee payer clearly (optional no-op amount 0 not allowed).
    // Memo-only txs are valid on Solana; skip transfer.
    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: 'confirmed',
      maxRetries: 3,
    })
    return {
      ok: true,
      signature,
      memo,
      feePayer: payer.publicKey.toBase58(),
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to send reveal memo transaction',
      memo,
    }
  }
}
