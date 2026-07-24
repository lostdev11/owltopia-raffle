'use client'

/**
 * Wallet Approve of the nesting freeze authority as SPL token delegate (Gen 2 / Token Metadata nests).
 * Ledger-friendly: plain Approve (+ optional platform fee) — same signAndSend path as Gen 1 Core locks.
 */
import {
  createApproveInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type SendOptions,
  type TransactionSignature,
} from '@solana/web3.js'
import { assertPhantomUsesWalletSignAndSend } from '@/lib/solana/phantom-safe-umi-send'
import { assertTransactionSimulatesClean } from '@/lib/solana/phantom-presimulate'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'

/** Max Gen 2 Approves per wallet tx (room for Phantom Lighthouse + optional fee ix). */
export const NESTING_TM_APPROVE_WALLET_BATCH_MAX = 12

export type TokenMetadataNestApproveFee = {
  treasury: string
  lamports: number
}

function ownerPubkey(wallet: any): PublicKey {
  const raw = wallet?.publicKey ?? wallet?.adapter?.publicKey
  if (!raw) throw new Error('Connect your wallet first.')
  return raw instanceof PublicKey ? raw : new PublicKey(String(raw))
}

/**
 * One wallet transaction: Approve nesting as delegate on each NFT ATA (+ optional platform fee).
 * After this confirms, POST /api/me/staking/freeze runs FreezeDelegatedAccount server-side.
 */
export async function approveTokenMetadataNestDelegatesInWallet(params: {
  connection: Connection
  wallet: any
  mintIds: string[]
  delegateAddress: string
  platformFee?: TokenMetadataNestApproveFee | null
  sendTransaction?: WalletSendTransactionFn
}): Promise<string | null> {
  assertPhantomUsesWalletSignAndSend({
    wallet: params.wallet,
    sendTransaction: params.sendTransaction,
    action: 'nest lock',
  })
  if (!params.sendTransaction) {
    throw new Error('Wallet sendTransaction is required for Gen 2 nest approve.')
  }

  const owner = ownerPubkey(params.wallet)
  const delegate = new PublicKey(params.delegateAddress.trim())
  const mints = [...new Set(params.mintIds.map((id) => id.trim()).filter(Boolean))]
  if (mints.length === 0) return null

  const tx = new Transaction()
  for (const mintStr of mints) {
    const mint = new PublicKey(mintStr)
    const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID)
    tx.add(createApproveInstruction(ata, delegate, owner, 1, [], TOKEN_PROGRAM_ID))
  }

  const fee = params.platformFee
  if (fee && fee.lamports > 0 && fee.treasury.trim()) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: new PublicKey(fee.treasury.trim()),
        lamports: fee.lamports,
      })
    )
  }

  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash('confirmed')
  tx.feePayer = owner
  tx.recentBlockhash = blockhash

  await assertTransactionSimulatesClean(params.connection, tx, {
    failMessagePrefix: 'Nest approve would fail on-chain before wallet approval.',
  })

  const signature = await params.sendTransaction(tx, params.connection, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  } as SendOptions)

  await params.connection.confirmTransaction(
    { signature: signature as TransactionSignature, blockhash, lastValidBlockHeight },
    'confirmed'
  )

  return signature
}
