import type { Raffle } from '@/lib/types'
import { getPaymentSplit } from '@/lib/raffles/split-at-purchase'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'

/**
 * Payout splits for one paid raffle line (same semantics as `/api/entries/create` payment routing).
 */
export async function payoutLinesForRaffleAmount(args: {
  raffle: Raffle
  treasuryWallet: string
  /** Gross amount owed for this raffle line after server pricing (stored on entry.amount_paid). */
  finalAmountPaid: number
}): Promise<Array<{ recipient: string; amount: number }>> {
  const { raffle, treasuryWallet, finalAmountPaid } = args
  if (!Number.isFinite(finalAmountPaid) || finalAmountPaid <= 0) {
    return []
  }

  const payToFundsEscrow = raffleUsesFundsEscrow(raffle)
  const fundsEscrowAddr =
    (raffle.funds_escrow_address_snapshot?.trim() || getFundsEscrowPublicKey()) ?? ''

  if (payToFundsEscrow) {
    if (!fundsEscrowAddr) return []
    return [{ recipient: fundsEscrowAddr.trim(), amount: finalAmountPaid }]
  }

  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  if (creatorWallet) {
    const { toCreator, toTreasury } = await getPaymentSplit(finalAmountPaid, creatorWallet)
    return [
      { recipient: creatorWallet, amount: toCreator },
      { recipient: treasuryWallet.trim(), amount: toTreasury },
    ]
  }

  return [{ recipient: treasuryWallet.trim(), amount: finalAmountPaid }]
}

export async function mergeBatchPayoutLines(args: {
  treasuryWallet: string
  pairs: ReadonlyArray<{ entry: Pick<{ amount_paid: number }, 'amount_paid'>; raffle: Raffle }>
}): Promise<Array<{ recipient: string; amount: number }>> {
  const acc = new Map<string, number>()
  const tw = args.treasuryWallet.trim()

  for (const { entry, raffle } of args.pairs) {
    const gross = Number(entry.amount_paid)
    const legs = await payoutLinesForRaffleAmount({
      raffle,
      treasuryWallet: tw,
      finalAmountPaid: gross,
    })
    for (const leg of legs) {
      const r = leg.recipient.trim()
      if (!r) continue
      const prev = acc.get(r) ?? 0
      acc.set(r, prev + leg.amount)
    }
  }

  return [...acc.entries()].map(([recipient, amount]) => ({
    recipient,
    amount,
  }))
}
