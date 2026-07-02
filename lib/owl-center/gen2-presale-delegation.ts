import { getBalanceByWallet, type Gen2BalanceRow } from '@/lib/gen2-presale/db'
import {
  getPresaleDelegationByMintWallet,
  getPresaleDelegationBySourceWallet,
} from '@/lib/db/gen2-presale-delegations'
import { decideGen1Delegation } from '@/lib/owl-center/gen2-mint-delegation'

/**
 * Presale balance resolved through admin "switch wallet for mint" delegations (migration 180).
 *
 * - Connected wallet is a delegation `mint_wallet`: credit it with the source wallet's
 *   presale balance row (`delegated_from`).
 * - Connected wallet is a delegated `source_wallet`: block presale minting (`delegated_away_to`).
 * - Otherwise: the connected wallet's own presale balance row.
 */
export type ResolvedPresaleBalance = {
  balance: Gen2BalanceRow | null
  /** Wallet whose gen2_presale_balances row backs eligibility / confirm debit. */
  credit_wallet: string
  delegated_from: string | null
  delegated_away_to: string | null
}

export async function resolvePresaleBalanceForMint(connectedWallet: string): Promise<ResolvedPresaleBalance> {
  const [asMint, asSource] = await Promise.all([
    getPresaleDelegationByMintWallet(connectedWallet),
    getPresaleDelegationBySourceWallet(connectedWallet),
  ])

  const decision = decideGen1Delegation(asMint, asSource)

  if (decision.kind === 'delegated_away') {
    return {
      balance: null,
      credit_wallet: connectedWallet,
      delegated_from: null,
      delegated_away_to: decision.mint_wallet,
    }
  }

  if (decision.kind === 'on_behalf') {
    const balance = await getBalanceByWallet(decision.source_wallet)
    return {
      balance,
      credit_wallet: decision.source_wallet,
      delegated_from: decision.source_wallet,
      delegated_away_to: null,
    }
  }

  const balance = await getBalanceByWallet(connectedWallet)
  return {
    balance,
    credit_wallet: connectedWallet,
    delegated_from: null,
    delegated_away_to: null,
  }
}
