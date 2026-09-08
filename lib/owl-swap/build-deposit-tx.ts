/**
 * Client-safe helpers to build OwlSwap deposit transactions.
 * Maker: NFTs (+ optional SOL) → escrow.
 * Taker accept: NFTs (+ optional SOL) → escrow + Owl fee → treasury.
 */

'use client'

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import {
  OWL_SWAP_COMPUTE_UNIT_LIMIT,
  OWL_SWAP_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
} from '@/lib/owl-swap/constants'
import {
  resolveMintTokenProgram,
  resolveOwlSendSplHolder,
} from '@/lib/owl-send/resolve-spl-holder'

export type OwlSwapDepositMint = {
  mint: string
  name?: string | null
  tokenAccount?: string | null
}

function prependComputeBudget(tx: Transaction): Transaction {
  const already = tx.instructions.some((ix) =>
    ix.programId.equals(ComputeBudgetProgram.programId)
  )
  if (already) return tx
  tx.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: OWL_SWAP_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({
      units: OWL_SWAP_COMPUTE_UNIT_LIMIT,
    })
  )
  return tx
}

async function appendNftTransfers(params: {
  connection: Connection
  owner: PublicKey
  escrow: PublicKey
  mints: OwlSwapDepositMint[]
  tx: Transaction
}): Promise<{ ok: true; newAtaCount: number } | { ok: false; error: string }> {
  let newAtaCount = 0
  for (const item of params.mints) {
    let mintPk: PublicKey
    try {
      mintPk = new PublicKey(item.mint.trim())
    } catch {
      return { ok: false, error: `Invalid mint: ${item.mint}` }
    }

    const holder = await resolveOwlSendSplHolder({
      connection: params.connection,
      mint: mintPk,
      owner: params.owner,
      hintTokenAccount: item.tokenAccount,
    })
    if (!holder) {
      const program = await resolveMintTokenProgram(params.connection, mintPk)
      if (!program) {
        return {
          ok: false,
          error: `Could not resolve token program for ${item.name ?? item.mint}.`,
        }
      }
      return {
        ok: false,
        error: `Could not find transferable SPL NFT ${item.name ?? item.mint.slice(0, 8)}… in your wallet.`,
      }
    }

    const destAta = await getAssociatedTokenAddress(
      mintPk,
      params.escrow,
      false,
      holder.tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    let destExists = false
    try {
      await getAccount(params.connection, destAta, 'confirmed', holder.tokenProgram)
      destExists = true
    } catch {
      destExists = false
    }
    if (!destExists) {
      params.tx.add(
        createAssociatedTokenAccountInstruction(
          params.owner,
          destAta,
          params.escrow,
          mintPk,
          holder.tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
      newAtaCount += 1
    }

    params.tx.add(
      createTransferInstruction(
        holder.tokenAccount,
        destAta,
        params.owner,
        1,
        [],
        holder.tokenProgram
      )
    )
  }
  return { ok: true, newAtaCount }
}

/** Build maker deposit: selected SPL NFTs + optional SOL sweetener → escrow. */
export async function buildOwlSwapMakerDepositTx(params: {
  connection: Connection
  owner: PublicKey
  escrowAddress: string
  mints: OwlSwapDepositMint[]
  solLamports?: number
}): Promise<
  | { ok: true; tx: Transaction; newAtaCount: number }
  | { ok: false; error: string }
> {
  let escrow: PublicKey
  try {
    escrow = new PublicKey(params.escrowAddress.trim())
  } catch {
    return { ok: false, error: 'Invalid escrow address.' }
  }

  if (params.mints.length < 1 && !(params.solLamports && params.solLamports > 0)) {
    return { ok: false, error: 'Select at least one NFT or add a SOL sweetener.' }
  }

  const tx = new Transaction()
  const nftResult = await appendNftTransfers({
    connection: params.connection,
    owner: params.owner,
    escrow,
    mints: params.mints,
    tx,
  })
  if (!nftResult.ok) return nftResult

  const sol = Math.max(0, Math.floor(params.solLamports ?? 0))
  if (sol > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: params.owner,
        toPubkey: escrow,
        lamports: sol,
      })
    )
  }

  prependComputeBudget(tx)
  return { ok: true, tx, newAtaCount: nftResult.newAtaCount }
}

/**
 * Build taker accept deposit: NFTs + optional SOL → escrow, plus Owl fee → treasury.
 */
export async function buildOwlSwapTakerDepositTx(params: {
  connection: Connection
  owner: PublicKey
  escrowAddress: string
  mints: OwlSwapDepositMint[]
  solLamports?: number
  /** Discounted Owl fee in lamports (taker pays). */
  feeLamports: number
}): Promise<
  | { ok: true; tx: Transaction; newAtaCount: number }
  | { ok: false; error: string }
> {
  let escrow: PublicKey
  try {
    escrow = new PublicKey(params.escrowAddress.trim())
  } catch {
    return { ok: false, error: 'Invalid escrow address.' }
  }

  const fee = Math.max(0, Math.floor(params.feeLamports))
  if (fee > 0) {
    const treasury = getPlatformFeeTreasuryWalletAddressClient()
    if (!treasury) {
      return {
        ok: false,
        error:
          'Owl fee treasury is not configured (NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET).',
      }
    }
  }

  if (params.mints.length < 1 && !(params.solLamports && params.solLamports > 0) && fee <= 0) {
    return { ok: false, error: 'Offer your NFTs and/or SOL, or the fee must be paid.' }
  }

  const tx = new Transaction()
  const nftResult = await appendNftTransfers({
    connection: params.connection,
    owner: params.owner,
    escrow,
    mints: params.mints,
    tx,
  })
  if (!nftResult.ok) return nftResult

  const sol = Math.max(0, Math.floor(params.solLamports ?? 0))
  if (sol > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: params.owner,
        toPubkey: escrow,
        lamports: sol,
      })
    )
  }

  if (fee > 0) {
    const treasury = getPlatformFeeTreasuryWalletAddressClient()!
    tx.add(
      SystemProgram.transfer({
        fromPubkey: params.owner,
        toPubkey: new PublicKey(treasury),
        lamports: fee,
      })
    )
  }

  prependComputeBudget(tx)
  return { ok: true, tx, newAtaCount: nftResult.newAtaCount }
}

/** Re-export token program ids for callers that need them. */
export const OWL_SWAP_TOKEN_PROGRAMS = {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} as const
