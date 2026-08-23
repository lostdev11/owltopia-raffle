/**
 * Client-side: transfer native SOL from the connected wallet to any recipient.
 */
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'

export type SendSolTxFn = (
  transaction: Transaction,
  connection: Connection,
  options?: {
    skipPreflight?: boolean
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized'
    maxRetries?: number
  }
) => Promise<string>

/**
 * Deposit `amountSol` from `publicKey` to `recipientAddress`.
 * Leaves a small buffer so the wallet can pay tx fees on the same tx.
 */
export async function depositSolToWalletFromWallet(params: {
  connection: Connection
  publicKey: PublicKey
  sendTransaction: SendSolTxFn
  recipientAddress: string
  amountSol: number
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  if (!Number.isFinite(params.amountSol) || params.amountSol <= 0) {
    return { ok: false, error: 'Enter a valid SOL amount.' }
  }

  let recipientPk: PublicKey
  try {
    recipientPk = new PublicKey(params.recipientAddress.trim())
  } catch {
    return { ok: false, error: 'Invalid recipient address.' }
  }

  const lamports = Math.round(params.amountSol * LAMPORTS_PER_SOL)
  if (lamports <= 0) {
    return { ok: false, error: 'SOL amount is too small.' }
  }

  const balance = await params.connection.getBalance(params.publicKey, 'confirmed')
  const feeBuffer = 5000
  if (balance < lamports + feeBuffer) {
    const have = balance / LAMPORTS_PER_SOL
    return {
      ok: false,
      error: `Not enough SOL in wallet (have ${have.toFixed(4)}, need ~${params.amountSol} + fees).`,
    }
  }

  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: params.publicKey }).add(
    SystemProgram.transfer({
      fromPubkey: params.publicKey,
      toPubkey: recipientPk,
      lamports,
    })
  )

  try {
    const signature = await params.sendTransaction(tx, params.connection, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    })
    await params.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    )
    await confirmSignatureSuccessOnChain(params.connection, signature)
    return { ok: true, signature }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/User rejected|cancelled|denied/i.test(msg)) {
      return { ok: false, error: 'Wallet cancelled the SOL deposit.' }
    }
    return { ok: false, error: msg || 'SOL deposit transaction failed.' }
  }
}
