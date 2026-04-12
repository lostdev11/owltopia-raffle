'use client'

import { useCallback } from 'react'
import type { SendTransactionOptions } from '@solana/wallet-adapter-base'
import { useWallet } from '@solana/wallet-adapter-react'
import type { Connection } from '@solana/web3.js'
import type { Transaction, VersionedTransaction } from '@solana/web3.js'
import { sendTransactionPreferPhantomSignAndSend } from '@/lib/solana/phantom-sign-and-send-transaction'

/**
 * Same contract as `useWallet().sendTransaction`, but when the user is on Phantom
 * and the injected provider matches the connected key, submits via
 * `window.phantom.solana.signAndSendTransaction` so Lighthouse guard instructions
 * can be applied. Other wallets are unchanged.
 */
export function useSendTransactionForWallet() {
  const { wallet, publicKey, sendTransaction, connected } = useWallet()

  return useCallback(
    async (
      transaction: Transaction | VersionedTransaction,
      connection: Connection,
      options?: SendTransactionOptions
    ) => {
      if (!connected || !wallet?.adapter) {
        return sendTransaction(transaction, connection, options)
      }
      return sendTransactionPreferPhantomSignAndSend({
        transaction,
        connection,
        options,
        adapter: wallet.adapter,
        publicKey,
        fallbackSendTransaction: sendTransaction,
      })
    },
    [connected, wallet?.adapter, publicKey, sendTransaction]
  )
}
