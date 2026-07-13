/**
 * Client-side: transfer OWL (SPL) from the connected wallet to Discord marketplace escrow.
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import { owlUiToRawBigint } from '@/lib/council/owl-amount-format'

export type SendTxFn = (
  transaction: Transaction,
  connection: Connection,
  options?: {
    skipPreflight?: boolean
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized'
    maxRetries?: number
  }
) => Promise<string>

async function tokenProgramHoldingMint(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID> {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        owner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const account = await getAccount(connection, ata, 'confirmed', programId)
      if (account.amount > 0n) return programId
    } catch {
      // try next
    }
  }
  return TOKEN_PROGRAM_ID
}

/**
 * Deposit `amountUi` OWL from `publicKey` to marketplace escrow.
 * Creates escrow ATA if missing. Returns on-chain signature.
 */
export async function depositOwlToMarketplaceEscrowFromWallet(params: {
  connection: Connection
  publicKey: PublicKey
  sendTransaction: SendTxFn
  escrowAddress: string
  amountUi: number
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  if (!isOwlEnabled()) {
    return { ok: false, error: 'OWL is not configured (NEXT_PUBLIC_OWL_MINT_ADDRESS).' }
  }
  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) {
    return { ok: false, error: 'OWL mint address missing.' }
  }
  if (!Number.isFinite(params.amountUi) || params.amountUi <= 0) {
    return { ok: false, error: 'Invalid OWL amount.' }
  }

  let escrowPk: PublicKey
  try {
    escrowPk = new PublicKey(params.escrowAddress.trim())
  } catch {
    return { ok: false, error: 'Invalid marketplace escrow address.' }
  }

  const mint = new PublicKey(owl.mintAddress)
  const amountRaw = owlUiToRawBigint(params.amountUi, owl.decimals)
  if (amountRaw <= 0n) {
    return { ok: false, error: 'Invalid OWL amount.' }
  }

  const programId = await tokenProgramHoldingMint(params.connection, params.publicKey, mint)

  const senderAta = await getAssociatedTokenAddress(
    mint,
    params.publicKey,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const recipientAta = await getAssociatedTokenAddress(
    mint,
    escrowPk,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  try {
    const senderAcc = await getAccount(params.connection, senderAta, 'confirmed', programId)
    if (senderAcc.amount < amountRaw) {
      const have = Number(senderAcc.amount) / 10 ** owl.decimals
      return {
        ok: false,
        error: `Not enough OWL in wallet (have ${have.toLocaleString()}, need ${params.amountUi}).`,
      }
    }
  } catch {
    return { ok: false, error: 'No OWL token account in this wallet for the configured mint.' }
  }

  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: params.publicKey })

  try {
    await getAccount(params.connection, recipientAta, 'confirmed', programId)
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        params.publicKey,
        recipientAta,
        escrowPk,
        mint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }

  tx.add(
    createTransferInstruction(senderAta, recipientAta, params.publicKey, amountRaw, [], programId)
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
      return { ok: false, error: 'Wallet cancelled the OWL deposit.' }
    }
    return { ok: false, error: msg || 'OWL deposit transaction failed.' }
  }
}
