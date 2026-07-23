import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import {
  checkEscrowHoldsNft,
  getPrizeEscrowPublicKey,
  payoutFungibleSplFromEscrowToRecipient,
  payoutNativeSolFromEscrowToRecipient,
  payoutSplLegacyWithCoreCompressedFallback,
} from '@/lib/raffles/prize-escrow'
import { getSolanaReadConnection } from '@/lib/solana/connection'
import { getTokenInfo } from '@/lib/tokens'
import { verifyBuyoutDepositTx } from '@/lib/verify-buyout-deposit'
import type { NftAuction } from '@/lib/auctions/types'
import type { PrizeStandard } from '@/lib/types'

function asPrizeStandard(value: string | null): PrizeStandard | null {
  if (
    value === 'spl' ||
    value === 'token2022' ||
    value === 'mpl_core' ||
    value === 'compressed'
  ) {
    return value
  }
  return null
}

export async function verifyAuctionPrizeDeposit(params: {
  auction: NftAuction
  depositTx?: string | null
}): Promise<{ ok: true } | { ok: false; error: string; httpStatus: number }> {
  const { auction, depositTx } = params
  const escrow = getPrizeEscrowPublicKey()
  if (!escrow) {
    return { ok: false, error: 'Prize escrow is not configured', httpStatus: 503 }
  }

  if (auction.prize_type === 'nft') {
    if (!auction.nft_mint_address) {
      return { ok: false, error: 'Missing NFT mint', httpStatus: 400 }
    }
    const hold = await checkEscrowHoldsNft({
      prize_type: 'nft',
      nft_mint_address: auction.nft_mint_address,
      nft_token_id: auction.nft_token_id,
      prize_standard: asPrizeStandard(auction.prize_standard),
    })
    if (!hold.holds) {
      return {
        ok: false,
        error: hold.error || 'NFT not found in prize escrow yet',
        httpStatus: 400,
      }
    }
    return { ok: true }
  }

  const amount = Number(auction.prize_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Invalid prize amount', httpStatus: 400 }
  }

  const currency = auction.prize_type === 'usdc' ? 'USDC' : 'SOL'
  if (depositTx?.trim()) {
    const verified = await verifyBuyoutDepositTx({
      transactionSignature: depositTx.trim(),
      bidderWallet: auction.creator_wallet,
      depositWallet: escrow,
      expectedAmount: amount,
      currency,
      allowOlderThanHour: true,
    })
    if (!verified.valid) {
      return { ok: false, error: verified.error || 'Deposit tx invalid', httpStatus: 400 }
    }
    return { ok: true }
  }

  // Fallback: escrow balance check (best-effort; prefer deposit_tx).
  const connection = getSolanaReadConnection()
  const escrowPk = new PublicKey(escrow)
  if (currency === 'SOL') {
    const lamports = await connection.getBalance(escrowPk, 'confirmed')
    if (lamports < Math.round(amount * LAMPORTS_PER_SOL)) {
      return {
        ok: false,
        error: 'Escrow SOL balance is below the declared prize. Transfer the prize and retry (include deposit_tx).',
        httpStatus: 400,
      }
    }
    return { ok: true }
  }

  const usdc = getTokenInfo('USDC')
  if (!usdc?.mintAddress) {
    return { ok: false, error: 'USDC mint not configured', httpStatus: 503 }
  }
  const mint = new PublicKey(usdc.mintAddress)
  let raw = 0n
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const ata = await getAssociatedTokenAddress(mint, escrowPk, false, programId)
      const acct = await getAccount(connection, ata, 'confirmed', programId)
      raw = acct.amount
      break
    } catch {
      // try next
    }
  }
  const need = BigInt(Math.round(amount * 10 ** (usdc.decimals ?? 6)))
  if (raw < need) {
    return {
      ok: false,
      error: 'Escrow USDC balance is below the declared prize. Transfer and retry with deposit_tx.',
      httpStatus: 400,
    }
  }
  return { ok: true }
}

export async function transferAuctionPrizeToRecipient(params: {
  auction: NftAuction
  recipientWallet: string
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const { auction, recipientWallet } = params
  if (auction.prize_type === 'nft') {
    if (!auction.nft_mint_address) return { ok: false, error: 'Missing NFT mint' }
    const result = await payoutSplLegacyWithCoreCompressedFallback(
      {
        nft_mint_address: auction.nft_mint_address,
        nft_token_id: auction.nft_token_id,
      },
      recipientWallet
    )
    if (!result.ok || !result.signature) {
      return { ok: false, error: result.error || 'NFT transfer failed' }
    }
    return { ok: true, signature: result.signature }
  }

  const amount = Number(auction.prize_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Invalid prize amount' }
  }

  if (auction.prize_type === 'sol') {
    const lamports = BigInt(Math.round(amount * LAMPORTS_PER_SOL))
    const result = await payoutNativeSolFromEscrowToRecipient(recipientWallet, lamports)
    if (!result.ok || !result.signature) {
      return { ok: false, error: result.error || 'SOL prize transfer failed' }
    }
    return { ok: true, signature: result.signature }
  }

  const usdc = getTokenInfo('USDC')
  if (!usdc?.mintAddress) return { ok: false, error: 'USDC mint not configured' }
  const decimals = usdc.decimals ?? 6
  const raw = BigInt(Math.round(amount * 10 ** decimals))
  const result = await payoutFungibleSplFromEscrowToRecipient(
    usdc.mintAddress,
    recipientWallet,
    raw
  )
  if (!result.ok || !result.signature) {
    return { ok: false, error: result.error || 'USDC prize transfer failed' }
  }
  return { ok: true, signature: result.signature }
}
