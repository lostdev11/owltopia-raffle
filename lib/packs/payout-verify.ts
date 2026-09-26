import { PublicKey } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { getSolanaReadConnection } from '@/lib/solana/connection'
import { MAX_SUPPORTED_TRANSACTION_VERSION } from '@/lib/solana/transaction-version'
import { getTokenInfo } from '@/lib/tokens'
import { withPackSolanaRpcRetry } from '@/lib/packs/rpc-retry'
import type { PackOpenRow } from '@/lib/packs/types'
import { solToLamports } from '@/lib/packs/config'

const CONFIRM_POLL_MS = 1_500

async function signatureSucceededOnChain(signature: string): Promise<boolean> {
  const connection = getSolanaReadConnection()
  return withPackSolanaRpcRetry(async () => {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
    })
    if (tx?.meta) return tx.meta.err == null

    const st = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })
    const s = st?.value?.[0]
    if (s?.err) return false
    return (
      s?.confirmationStatus === 'processed' ||
      s?.confirmationStatus === 'confirmed' ||
      s?.confirmationStatus === 'finalized'
    )
  })
}

async function recipientHoldsNftMint(
  recipientWallet: string,
  mintAddress: string
): Promise<boolean> {
  const connection = getSolanaReadConnection()
  const owner = new PublicKey(recipientWallet.trim())
  const mint = new PublicKey(mintAddress.trim())

  return withPackSolanaRpcRetry(async () => {
    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      try {
        const ata = await getAssociatedTokenAddress(
          mint,
          owner,
          false,
          program,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
        const acc = await getAccount(connection, ata, 'confirmed', program)
        if (acc.amount >= 1n) return true
      } catch {
        // try next program / no ATA
      }
    }
    return false
  })
}

async function recipientReceivedOwl(
  recipientWallet: string,
  minUiAmount: number
): Promise<boolean> {
  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress || !(minUiAmount > 0)) return false
  const connection = getSolanaReadConnection()
  const owner = new PublicKey(recipientWallet.trim())
  const mint = new PublicKey(owl.mintAddress)
  const minRaw = BigInt(Math.floor(minUiAmount * 10 ** owl.decimals * 0.999))

  return withPackSolanaRpcRetry(async () => {
    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      try {
        const ata = await getAssociatedTokenAddress(
          mint,
          owner,
          false,
          program,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
        const acc = await getAccount(connection, ata, 'confirmed', program)
        if (acc.amount >= minRaw) return true
      } catch {
        // no ATA
      }
    }
    return false
  })
}

/**
 * Before marking refund_needed, check whether the prize already landed on-chain
 * (confirm timeout / RPC 429 after sendRawTransaction is a common prod failure mode).
 */
export async function detectPackPayoutAlreadyLanded(open: PackOpenRow): Promise<{
  landed: boolean
  signature: string | null
}> {
  const sig = open.payout_signature?.trim()
  if (sig) {
    try {
      if (await signatureSucceededOnChain(sig)) {
        return { landed: true, signature: sig }
      }
    } catch {
      // fall through to prize-specific heuristics
    }
  }

  const buyer = open.buyer_wallet.trim()
  const category = open.category

  if (category === 'nft' && open.nft_mint_address) {
    try {
      if (await recipientHoldsNftMint(buyer, open.nft_mint_address)) {
        return { landed: true, signature: sig ?? null }
      }
    } catch {
      // ignore
    }
  }

  if (category === 'owl' && open.owl_amount != null && open.owl_amount > 0) {
    try {
      if (await recipientReceivedOwl(buyer, open.owl_amount)) {
        return { landed: true, signature: sig ?? null }
      }
    } catch {
      // ignore
    }
  }

  if (
    (category === 'sol' || category === 'jackpot') &&
    open.sol_amount != null &&
    open.sol_amount > 0 &&
    sig
  ) {
    try {
      if (await signatureSucceededOnChain(sig)) {
        return { landed: true, signature: sig }
      }
    } catch {
      // ignore
    }
  }

  return { landed: false, signature: sig ?? null }
}

/** Poll until confirmed or timeout — slower interval than web3.js default confirmTransaction. */
export async function waitForPackPayoutConfirmation(
  signature: string,
  timeoutMs = 45_000
): Promise<boolean> {
  const started = Date.now()
  while Date.now() - started < timeoutMs) {
    try {
      if (await signatureSucceededOnChain(signature)) return true
    } catch {
      // retry on next tick
    }
    await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS))
  }
  return signatureSucceededOnChain(signature).catch(() => false)
}

export function packPayoutLamportsForOpen(open: PackOpenRow): bigint | null {
  if (open.category === 'jackpot' || open.category === 'sol') {
    const sol = open.sol_amount ?? open.jackpot_amount_sol
    if (sol == null || !(sol > 0)) return null
    return solToLamports(sol)
  }
  return null
}
