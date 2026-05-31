import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import type { Raffle } from '@/lib/types'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getTransactionCached } from '@/lib/solana-rpc-transaction-cache'
import { getFullAccountKeysForTransaction } from '@/lib/verify-transaction'

export type PaymentTransactionDetails = {
  walletAddress: string
  amount: number
  currency: 'SOL' | 'USDC' | 'OWL'
}

export type TxDetailsResult =
  | { ok: true; data: PaymentTransactionDetails }
  | { ok: false; reason: 'NOT_FOUND' | 'PARSE_FAILED' | 'CONFIG'; detail?: string }

export function collectFundsEscrowAddresses(hints?: { raffle?: Raffle | null }): string[] {
  const out: string[] = []
  const envEscrow = getFundsEscrowPublicKey()?.trim()
  if (envEscrow) out.push(envEscrow)
  const snap = hints?.raffle?.funds_escrow_address_snapshot?.trim()
  if (snap && !out.includes(snap)) out.push(snap)
  return out
}

/**
 * Fetch ticket payment details from an on-chain transaction (treasury, split, or funds escrow).
 */
export async function getPaymentTransactionDetails(
  transactionSignature: string,
  hints?: { raffle?: Raffle | null }
): Promise<TxDetailsResult> {
  try {
    const rpcUrl = resolveServerSolanaRpcUrl()
    const connection = new Connection(rpcUrl, 'confirmed')

    const recipientWallet =
      process.env.RAFFLE_RECIPIENT_WALLET || process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET

    if (!recipientWallet) {
      console.error('Recipient wallet not configured')
      return { ok: false, reason: 'CONFIG', detail: 'Recipient wallet not configured' }
    }

    const recipientPubkey = new PublicKey(recipientWallet)

    const fetchOptions = [
      { commitment: 'confirmed' as const, maxSupportedTransactionVersion: 0 },
      { commitment: 'confirmed' as const },
      { commitment: 'finalized' as const, maxSupportedTransactionVersion: 0 },
      { commitment: 'finalized' as const },
    ]
    const transaction = await getTransactionCached(transactionSignature, async () => {
      for (const opts of fetchOptions) {
        const tx = await connection.getTransaction(transactionSignature, opts)
        if (tx) return tx
        await new Promise(r => setTimeout(r, 500))
      }
      return null
    })

    if (!transaction) {
      return { ok: false, reason: 'NOT_FOUND' }
    }
    if (transaction.meta?.err || !transaction.meta) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'Transaction failed on chain or has no balance data' }
    }

    const accountKeysFull = getFullAccountKeysForTransaction({
      transaction: transaction.transaction,
      meta: transaction.meta,
    })
    if (accountKeysFull.length === 0) {
      return {
        ok: false,
        reason: 'PARSE_FAILED',
        detail: 'Could not resolve transaction account keys (incl. lookup tables)',
      }
    }

    const feePayerStr = accountKeysFull[0]!.toBase58()

    const solIncreaseAt = (pubkey: PublicKey): number => {
      const idx = accountKeysFull.findIndex(k => k.equals(pubkey))
      if (idx === -1) return 0
      const preBalance = transaction.meta!.preBalances[idx]
      const postBalance = transaction.meta!.postBalances[idx]
      return (postBalance - preBalance) / LAMPORTS_PER_SOL
    }

    const raffleHint = hints?.raffle

    if (raffleHint && !raffleUsesFundsEscrow(raffleHint)) {
      const cw = (raffleHint.creator_wallet || raffleHint.created_by || '').trim()
      if (cw) {
        try {
          const cPk = new PublicKey(cw)
          const cInc = solIncreaseAt(cPk)
          const tInc = solIncreaseAt(recipientPubkey)
          const gross = cInc + tInc
          if (gross > 1e-9 && (cInc > 0 || tInc > 0)) {
            return {
              ok: true,
              data: { walletAddress: feePayerStr, amount: gross, currency: 'SOL' },
            }
          }
        } catch {
          /* skip invalid creator wallet */
        }
      }
    }

    const treasurySolInc = solIncreaseAt(recipientPubkey)
    if (treasurySolInc > 0) {
      return {
        ok: true,
        data: { walletAddress: feePayerStr, amount: treasurySolInc, currency: 'SOL' },
      }
    }

    for (const escrowAddr of collectFundsEscrowAddresses(hints)) {
      try {
        const escrowPk = new PublicKey(escrowAddr.trim())
        const escrowSolInc = solIncreaseAt(escrowPk)
        if (escrowSolInc > 0) {
          return {
            ok: true,
            data: { walletAddress: feePayerStr, amount: escrowSolInc, currency: 'SOL' },
          }
        }
      } catch {
        /* invalid pubkey */
      }
    }

    const preTokenBalances = transaction.meta.preTokenBalances || []
    const postTokenBalances = transaction.meta.postTokenBalances || []

    const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    const recipientTokenAddress = await getAssociatedTokenAddress(USDC_MINT, recipientPubkey)
    const recipientTokenIndex = accountKeysFull.findIndex(k => k.equals(recipientTokenAddress))

    if (recipientTokenIndex !== -1) {
      const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
      if (matchingPostBalance) {
        const amount = parseFloat(matchingPostBalance.uiTokenAmount?.uiAmountString || '0')
        const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === recipientTokenIndex)
        const preAmount = matchingPreBalance
          ? parseFloat(matchingPreBalance.uiTokenAmount?.uiAmountString || '0')
          : 0
        const increase = amount - preAmount
        if (increase > 0) {
          return {
            ok: true,
            data: { walletAddress: feePayerStr, amount: increase, currency: 'USDC' },
          }
        }
      }
    }

    for (const escrowAddr of collectFundsEscrowAddresses(hints)) {
      try {
        const escrowPk = new PublicKey(escrowAddr.trim())
        const escrowUsdcAta = await getAssociatedTokenAddress(USDC_MINT, escrowPk)
        const escrowUsdcIdx = accountKeysFull.findIndex(k => k.equals(escrowUsdcAta))
        if (escrowUsdcIdx !== -1) {
          const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === escrowUsdcIdx)
          if (matchingPostBalance) {
            const amount = parseFloat(matchingPostBalance.uiTokenAmount?.uiAmountString || '0')
            const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === escrowUsdcIdx)
            const preAmount = matchingPreBalance
              ? parseFloat(matchingPreBalance.uiTokenAmount?.uiAmountString || '0')
              : 0
            const increase = amount - preAmount
            if (increase > 0) {
              return {
                ok: true,
                data: { walletAddress: feePayerStr, amount: increase, currency: 'USDC' },
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    const { getTokenInfo } = await import('@/lib/tokens')
    const owlTokenInfo = getTokenInfo('OWL')
    if (owlTokenInfo.mintAddress) {
      const OWL_MINT = new PublicKey(owlTokenInfo.mintAddress)
      const recipientOwlTokenAddress = await getAssociatedTokenAddress(OWL_MINT, recipientPubkey)
      const recipientOwlTokenIndex = accountKeysFull.findIndex(k => k.equals(recipientOwlTokenAddress))

      if (recipientOwlTokenIndex !== -1) {
        const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === recipientOwlTokenIndex)
        if (matchingPostBalance) {
          const amount = parseFloat(matchingPostBalance.uiTokenAmount?.uiAmountString || '0')
          const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === recipientOwlTokenIndex)
          const preAmount = matchingPreBalance
            ? parseFloat(matchingPreBalance.uiTokenAmount?.uiAmountString || '0')
            : 0
          const increase = amount - preAmount
          if (increase > 0) {
            return {
              ok: true,
              data: { walletAddress: feePayerStr, amount: increase, currency: 'OWL' },
            }
          }
        }
      }

      for (const escrowAddr of collectFundsEscrowAddresses(hints)) {
        try {
          const escrowPk = new PublicKey(escrowAddr.trim())
          const escrowOwlAta = await getAssociatedTokenAddress(OWL_MINT, escrowPk)
          const escrowOwlIdx = accountKeysFull.findIndex(k => k.equals(escrowOwlAta))
          if (escrowOwlIdx !== -1) {
            const matchingPostBalance = postTokenBalances.find(b => b.accountIndex === escrowOwlIdx)
            if (matchingPostBalance) {
              const amount = parseFloat(matchingPostBalance.uiTokenAmount?.uiAmountString || '0')
              const matchingPreBalance = preTokenBalances.find(b => b.accountIndex === escrowOwlIdx)
              const preAmount = matchingPreBalance
                ? parseFloat(matchingPreBalance.uiTokenAmount?.uiAmountString || '0')
                : 0
              const increase = amount - preAmount
              if (increase > 0) {
                return {
                  ok: true,
                  data: { walletAddress: feePayerStr, amount: increase, currency: 'OWL' },
                }
              }
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    return {
      ok: false,
      reason: 'PARSE_FAILED',
      detail:
        'No SOL, USDC, or OWL increase found on treasury, funds escrow, or corresponding token accounts.',
    }
  } catch (error) {
    console.error(
      'Error fetching payment transaction details:',
      error instanceof Error ? error.message : 'Unknown error'
    )
    return { ok: false, reason: 'NOT_FOUND', detail: error instanceof Error ? error.message : String(error) }
  }
}
