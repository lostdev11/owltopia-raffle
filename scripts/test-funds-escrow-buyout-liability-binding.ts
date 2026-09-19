/**
 * Buyout liability must not bind legacy treasury deposits to funds escrow.
 * Run: npm run test:funds-escrow-buyout-liability-binding
 */
import assert from 'node:assert/strict'
import {
  buyoutDepositBindsFundsEscrowLiability,
  filterBuyoutOffersInFundsEscrow,
} from '../lib/raffles/funds-escrow-buyout-liability'

const TREASURY = 'TreasuryWallet1111111111111111111111111111111111'

const offer = {
  deposit_tx_signature: '5abcLegacyTreasuryDeposit',
  bidder_wallet: 'Bidder1111111111111111111111111111111111111',
  amount: 3,
  currency: 'SOL' as const,
}

async function main() {
  const mockVerify = async (params: { depositWallet: string }) => {
    if (params.depositWallet === TREASURY) return { valid: true }
    return { valid: false }
  }

  process.env.RAFFLE_RECIPIENT_WALLET = TREASURY
  process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET = TREASURY
  delete process.env.FUNDS_ESCROW_SECRET_KEY

  assert.equal(await buyoutDepositBindsFundsEscrowLiability(offer, mockVerify as never), false)

  const escrowOnly = await filterBuyoutOffersInFundsEscrow([offer], mockVerify as never)
  assert.equal(escrowOnly.length, 0)

  console.log('ok: treasury buyouts excluded from funds-escrow liability binding')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
