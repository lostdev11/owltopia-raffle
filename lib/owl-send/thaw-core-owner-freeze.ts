'use client'

/**
 * Client-side OwlSend thaw for leftover MPL Core Owner FreezeDelegate locks
 * (admin force-leave / closed nest still frozen on-chain).
 */

import type { Connection } from '@solana/web3.js'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { thawMplCoreOwnerFreezeInWallet } from '@/lib/solana/mpl-core-freeze'
import { isMplCoreWrongAccountTypeError } from '@/lib/solana/mpl-core-transfer-errors'

export type OwlSendCoreOwnerThawMintResult = {
  mint: string
  /** Wallet signed updatePlugin(frozen:false). */
  thawed: boolean
  /** Not a Core Owner freeze (or already thawed) — caller may try Gen2 server thaw. */
  skipToGen2: boolean
  error?: string
}

/**
 * Attempt holder wallet thaw for each mint. Non-Core / already-thawed mints set skipToGen2.
 */
export async function thawOwlSendCoreOwnerFreezes(params: {
  connection: Connection
  wallet: any
  sendTransaction?: WalletSendTransactionFn
  mints: string[]
}): Promise<{ results: OwlSendCoreOwnerThawMintResult[]; thawedCount: number }> {
  const results: OwlSendCoreOwnerThawMintResult[] = []
  let thawedCount = 0

  for (const raw of params.mints) {
    const mint = raw.trim()
    if (!mint) continue
    try {
      const sig = await thawMplCoreOwnerFreezeInWallet({
        connection: params.connection,
        wallet: params.wallet,
        assetId: mint,
        sendTransaction: params.sendTransaction,
      })
      if (sig) {
        results.push({ mint, thawed: true, skipToGen2: false })
        thawedCount += 1
      } else {
        // Already thawed / no FreezeDelegate — Gen2 path may still apply for classic SPL.
        results.push({ mint, thawed: false, skipToGen2: true })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (
        isMplCoreWrongAccountTypeError(msg) ||
        /not a metaplex core|wrong account|not of the expected type|assetaccountdata/i.test(msg) ||
        /not wallet-controlled|freeze is not wallet-controlled/i.test(msg)
      ) {
        results.push({ mint, thawed: false, skipToGen2: true })
        continue
      }
      results.push({ mint, thawed: false, skipToGen2: false, error: msg })
    }
  }

  return { results, thawedCount }
}
