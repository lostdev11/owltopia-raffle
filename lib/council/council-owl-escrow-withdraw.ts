/**
 * SPL transfer: council escrow OWL ATA → recipient wallet ATA (signed by escrow keypair).
 */

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getCouncilOwlEscrowKeypair } from '@/lib/council/council-owl-escrow-keypair'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

export type CouncilOwlEscrowWithdrawResult =
  | { ok: true; signature: string }
  | { ok: false; error: string }

export async function transferCouncilOwlFromEscrowToWallet(params: {
  recipientWallet: string
  amountRaw: bigint
}): Promise<CouncilOwlEscrowWithdrawResult> {
  if (!isOwlEnabled()) {
    return { ok: false, error: 'OWL token is not configured' }
  }
  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) {
    return { ok: false, error: 'OWL mint not configured' }
  }
  if (params.amountRaw <= 0n) {
    return { ok: false, error: 'Withdraw amount must be positive' }
  }

  const kp = getCouncilOwlEscrowKeypair()
  if (!kp) {
    return { ok: false, error: 'Council OWL escrow is not configured' }
  }

  let recipient: PublicKey
  try {
    recipient = new PublicKey(params.recipientWallet.trim())
  } catch {
    return { ok: false, error: 'Invalid recipient wallet' }
  }

  const mint = new PublicKey(owl.mintAddress)
  const connection = getSolanaConnection()
  const escrowPk = kp.publicKey

  const fromAta = await getAssociatedTokenAddress(mint, escrowPk, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
  const toAta = await getAssociatedTokenAddress(
    mint,
    recipient,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  const tx = new Transaction()
  try {
    await getAccount(connection, toAta, 'confirmed', TOKEN_PROGRAM_ID)
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(escrowPk, toAta, recipient, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    )
  }

  tx.add(createTransferInstruction(fromAta, toAta, escrowPk, params.amountRaw, [], TOKEN_PROGRAM_ID))

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = escrowPk

    const sig = await connection.sendTransaction(tx, [kp], {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    })
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    return { ok: true, signature: sig }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg || 'Withdraw transfer failed' }
  }
}
