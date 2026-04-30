'use client'

import type { SendTransactionOptions } from '@solana/wallet-adapter-base'
import {
  Transaction,
  VersionedTransaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  type Connection,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getMint,
  getAccount,
  createAssociatedTokenAccountInstruction,
  type Mint,
} from '@solana/spl-token'
import type { Raffle } from '@/lib/types'
import { isSolanaRpcRateLimitError } from '@/lib/solana-rpc-rate-limit'
import { isOwlEnabled } from '@/lib/tokens'
import { fireGreenConfetti } from '@/lib/confetti'
import { clearReferralComplimentarySessionCache } from '@/lib/referrals/complimentary-session-client'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'

export type ExecuteRafflePurchaseResult =
  | { ok: true }
  | { ok: false; error: string; isUnconfirmedPayment?: boolean }

export type PurchasePaymentDetails = {
  recipient?: string
  amount?: number
  currency?: string
  usdcMint: string
  owlMint: string | null
  tokenDecimals: number
  split?: { recipient: string; amount: number }[]
}

type PaymentDetails = PurchasePaymentDetails

export type ExecuteRafflePurchaseOptions = {
  raffle: Raffle
  ticketQuantity: number
  publicKey: PublicKey
  connection: Connection
  sendTransaction: (
    tx: Transaction | VersionedTransaction,
    c: Connection,
    opts?: SendTransactionOptions
  ) => Promise<string>
  routerRefresh: () => void
  /** If set, runs after on-chain confirmation instead of optional confetti (e.g. close dialog + confetti). */
  afterPaymentTxConfirmed?: () => void
  /** Fire confetti after payment confirms on-chain when afterPaymentTxConfirmed is not set. */
  celebrateOnPaymentConfirmed?: boolean
  /** After referral complimentary ticket is confirmed. */
  onComplimentarySuccess?: () => void
  celebrateOnComplimentary?: boolean
  /** After POST /verify returns 200 */
  afterVerifyOk?: () => void
  /**
   * If set, replaces default router refresh on verify 202.
   * If omitted, only routerRefresh runs.
   */
  onVerifyPending?: (ctx: { entryId: string; transactionSignature: string }) => void | Promise<void>
}

function classifyPurchaseError(err: unknown): {
  message: string
  isUnconfirmedPayment: boolean
} {
  let errorMessage = 'Failed to purchase tickets'
  let isUnconfirmedPayment = false
  if (err instanceof Error) {
    const errMsg = err.message || ''
    const errorStr = err.toString()

    if (errMsg.includes('403') || errMsg.includes('Access forbidden')) {
      errorMessage = errMsg
    } else if (errMsg.includes('RPC endpoint') || errMsg.includes('RPC')) {
      errorMessage = errMsg
    } else if (
      errMsg.includes('Temporary internal error') ||
      errorStr.includes('code":19') ||
      errorStr.includes('"code":19')
    ) {
      errorMessage =
        'Temporary RPC error. Please try again in a moment. If this persists, the RPC endpoint may be experiencing issues. Consider setting NEXT_PUBLIC_SOLANA_RPC_URL to a private endpoint.'
    } else if (errMsg.includes('500') || errorStr.includes('"code":19')) {
      errorMessage = 'RPC server error. Please try again in a few moments.'
    } else if (errMsg.includes('Network') || errMsg.includes('timeout')) {
      errorMessage = 'Network error. Please check your connection and try again.'
    } else if (
      errMsg.includes('not confirmed on-chain in time') ||
      errMsg.includes('signature was returned, but')
    ) {
      errorMessage =
        'Transaction confirmation timed out. You can retry verify from your orders if payment went through.'
      isUnconfirmedPayment = true
    } else if (errMsg === 'server error' || errMsg.includes('Failed to verify')) {
      errorMessage =
        "Your payment was sent, but we couldn't confirm it right away. Refresh the page in a moment — your ticket should appear. If it doesn't, try again or contact support with your transaction signature."
      isUnconfirmedPayment = true
    } else {
      errorMessage = errMsg
    }
  }
  return { message: errorMessage, isUnconfirmedPayment }
}

async function getMintRetries(connection: Connection, mintPk: PublicKey): Promise<Mint> {
  let mintInfo: Mint | undefined
  let mintRetries = 3
  while (mintRetries > 0) {
    try {
      mintInfo = await getMint(connection, mintPk)
      break
    } catch (rpcError: unknown) {
      mintRetries--
      const rpcErr = rpcError as { message?: string; code?: number; name?: string }
      const errorMessage = rpcErr?.message || ''
      const errorCode = rpcErr?.code || (rpcErr as { error?: { code?: number } })?.error?.code
      const errorName = rpcErr?.name || ''

      const isFetchError =
        errorMessage.includes('failed to fetch') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('NetworkError') ||
        errorMessage.includes('Network request failed') ||
        errorName === 'TypeError' ||
        (errorName === 'TypeError' && errorMessage.includes('fetch')) ||
        errorMessage.includes('CORS') ||
        errorMessage.includes('network')

      if (
        isFetchError ||
        errorCode === 19 ||
        errorMessage.includes('Temporary internal error') ||
        errorMessage.includes('500') ||
        errorMessage.includes('Network') ||
        errorMessage.includes('timeout')
      ) {
        if (mintRetries === 0) {
          if (isFetchError) {
            throw new Error(
              'Network connection failed while fetching token mint information. This may be a network issue or CORS restriction on mobile. ' +
                'Please check your internet connection and try again. ' +
                'If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                'to a private RPC endpoint (Helius, Alchemy, or another private RPC) that supports mobile access.'
            )
          }
          throw new Error(
            'Failed to fetch mint information after retries. This may be a temporary RPC issue. ' +
              'Please try again in a moment. If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
              'to a private RPC endpoint (Helius, Alchemy, or another private RPC).'
          )
        }
        const backoffDelay = isFetchError ? 2000 * (3 - mintRetries) : 1000 * (3 - mintRetries)
        await new Promise(resolve => setTimeout(resolve, backoffDelay))
      } else {
        throw rpcError
      }
    }
  }
  if (!mintInfo) throw new Error('Failed to get mint information')
  return mintInfo
}

async function appendSplTransfersForPayments(
  connection: Connection,
  transaction: Transaction,
  publicKey: PublicKey,
  mintPk: PublicKey,
  payments: { recipient: string; amount: number }[],
  decimals: number
): Promise<void> {
  const senderTokenAddress = await getAssociatedTokenAddress(mintPk, publicKey)

  for (const p of payments) {
    const recipientPubkey = new PublicKey(p.recipient)
    const amount = BigInt(Math.round(p.amount * Math.pow(10, decimals)))
    const recipientTokenAddress = await getAssociatedTokenAddress(mintPk, recipientPubkey)

    let accountExists = false
    let accountRetries = 3
    while (accountRetries > 0 && !accountExists) {
      try {
        await getAccount(connection, recipientTokenAddress)
        accountExists = true
      } catch (error: unknown) {
        const err = error as { message?: string; code?: number; name?: string }
        const errorMessage = err?.message || ''
        const errorCode = err?.code || (error as { error?: { code?: number } }).error?.code
        const errorName = err?.name || ''
        if (
          errorMessage.includes('TokenAccountNotFoundError') ||
          errorMessage.includes('could not find account')
        ) {
          accountExists = false
          break
        }
        const isFetchError =
          errorMessage.includes('failed to fetch') ||
          errorMessage.includes('Failed to fetch') ||
          errorName === 'TypeError' ||
          errorMessage.includes('network')
        if (
          isFetchError ||
          errorCode === 19 ||
          errorMessage.includes('Temporary internal error') ||
          errorMessage.includes('500') ||
          errorMessage.includes('timeout')
        ) {
          accountRetries--
          if (accountRetries === 0) {
            accountExists = false
            break
          }
          await new Promise(resolve =>
            setTimeout(resolve, isFetchError ? 2000 * (3 - accountRetries) : 1000 * (3 - accountRetries))
          )
        } else {
          accountExists = false
          break
        }
      }
    }
    if (!accountExists) {
      transaction.add(
        createAssociatedTokenAccountInstruction(publicKey, recipientTokenAddress, recipientPubkey, mintPk)
      )
    }
    transaction.add(
      createTransferInstruction(senderTokenAddress, recipientTokenAddress, publicKey, amount, [])
    )
  }
}

async function fetchLatestBlockhash(connection: Connection): Promise<{
  blockhash: string
  lastValidBlockHeight: number
}> {
  let latestBlockhash: { blockhash: string; lastValidBlockHeight: number } | null = null
  let retries = 3

  while (retries > 0) {
    try {
      try {
        const result = await connection.getLatestBlockhash('confirmed')
        latestBlockhash = result
        break
      } catch (latestError: unknown) {
        const le = latestError as { message?: string; code?: number }
        const errorMsg = le?.message || ''
        if (errorMsg.includes('does not exist') || errorMsg.includes('not available') || le?.code === -32601) {
          try {
            const recentResult = await connection.getRecentBlockhash('confirmed')
            const slot = await connection.getSlot('confirmed')
            latestBlockhash = {
              blockhash: recentResult.blockhash,
              lastValidBlockHeight: slot,
            }
          } catch {
            const recentResult = await connection.getRecentBlockhash('confirmed')
            latestBlockhash = {
              blockhash: recentResult.blockhash,
              lastValidBlockHeight: 0,
            }
          }
          break
        }
        throw latestError
      }
    } catch (rpcError: unknown) {
      retries--
      const re = rpcError as { message?: string; code?: number; name?: string }
      const errorMessage = re?.message || ''
      const errorCode = re?.code || (re as { error?: { code?: number } }).error?.code
      const errorStr = JSON.stringify(rpcError)
      const errorName = re?.name || ''

      const isFetchError =
        errorMessage.includes('failed to fetch') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('NetworkError') ||
        errorMessage.includes('Network request failed') ||
        errorName === 'TypeError' ||
        (errorName === 'TypeError' && errorMessage.includes('fetch')) ||
        errorMessage.includes('CORS') ||
        errorMessage.includes('network')

      if (
        isFetchError ||
        errorMessage.includes('403') ||
        errorMessage.includes('Access forbidden') ||
        isSolanaRpcRateLimitError(rpcError) ||
        errorCode === 19 ||
        errorMessage.includes('Temporary internal error') ||
        errorMessage.includes('500') ||
        errorStr.includes('"code":19') ||
        errorMessage.includes('Network') ||
        errorMessage.includes('timeout')
      ) {
        if (retries === 0) {
          if (isFetchError) {
            throw new Error(
              'Network connection failed. This may be a network issue or CORS restriction on mobile. ' +
                'Please check your internet connection and try again. ' +
                'If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                'to a private RPC endpoint (Helius, Alchemy, or another private RPC) that supports mobile access.'
            )
          }
          if (
            errorMessage.includes('403') ||
            errorMessage.includes('Access forbidden') ||
            isSolanaRpcRateLimitError(rpcError)
          ) {
            throw new Error(
              'RPC endpoint is rate-limited or over quota (balances and purchases need a reliable RPC). ' +
                'Please set NEXT_PUBLIC_SOLANA_RPC_URL in your .env.local file to a private RPC endpoint ' +
                '(e.g., Helius, Alchemy, or another private RPC). Public RPC endpoints are rate-limited.'
            )
          }
          throw new Error(
            'Failed to get blockhash after retries. This may be a temporary RPC issue. ' +
              'Please try again in a moment. If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
              'to a private RPC endpoint (Helius, Alchemy, or another private RPC).'
          )
        }
        const backoffDelay = isFetchError ? 2000 * (3 - retries) : 1000 * (3 - retries)
        await new Promise(resolve => setTimeout(resolve, backoffDelay))
      } else {
        throw rpcError
      }
    }
  }

  if (!latestBlockhash) {
    throw new Error('Failed to get recent blockhash after retries')
  }
  return latestBlockhash
}

function resolvePaymentsFromPurchaseDetails(details: PurchasePaymentDetails): {
  recipient: string
  amount: number
}[] {
  if (details.split && details.split.length > 0) {
    return details.split.map(p => ({
      recipient: p.recipient.trim(),
      amount: Number(p.amount),
    }))
  }
  const r = details.recipient?.trim()
  if (r && details.amount != null && Number.isFinite(Number(details.amount))) {
    return [{ recipient: r, amount: Number(details.amount) }]
  }
  throw new Error('Invalid payment instructions')
}

/**
 * Build legacy `Transaction` (wallet sign) from server payment details — single or merged cart splits.
 */
export async function buildPurchaseTransactionFromPaymentDetails(
  connection: Connection,
  publicKey: PublicKey,
  raffleCurrency: string,
  paymentDetails: PurchasePaymentDetails
): Promise<Transaction> {
  const latestBlockhash = await fetchLatestBlockhash(connection)
  const transaction = new Transaction()
  transaction.recentBlockhash = latestBlockhash.blockhash
  if (latestBlockhash.lastValidBlockHeight) {
    transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight
  }
  transaction.feePayer = publicKey

  const payments = resolvePaymentsFromPurchaseDetails(paymentDetails)

  if (raffleCurrency === 'SOL') {
    for (const p of payments) {
      const lamports = Math.round(p.amount * LAMPORTS_PER_SOL)
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(p.recipient),
          lamports,
        })
      )
    }
  } else if (raffleCurrency === 'USDC') {
    const usdcMint = new PublicKey(paymentDetails.usdcMint)
    const mintInfo = await getMintRetries(connection, usdcMint)
    await appendSplTransfersForPayments(
      connection,
      transaction,
      publicKey,
      usdcMint,
      payments,
      mintInfo.decimals
    )
  } else if (raffleCurrency === 'OWL') {
    if (!paymentDetails.owlMint) throw new Error('OWL mint address not configured in payment details')
    const owlMint = new PublicKey(paymentDetails.owlMint)
    const mintInfo = await getMintRetries(connection, owlMint)
    await appendSplTransfersForPayments(
      connection,
      transaction,
      publicKey,
      owlMint,
      payments,
      mintInfo.decimals
    )
  } else {
    throw new Error(`Unsupported currency: ${raffleCurrency}`)
  }

  if (transaction.instructions.length === 0) {
    throw new Error('Transaction has no instructions. Please try again.')
  }

  return transaction
}

/**
 * Runs create → wallet pay → verify for one raffle line item (used by card, detail page, cart checkout).
 */
export async function executeRafflePurchase(opts: ExecuteRafflePurchaseOptions): Promise<ExecuteRafflePurchaseResult> {
  const {
    raffle,
    ticketQuantity,
    publicKey,
    connection,
    sendTransaction,
    routerRefresh,
    afterPaymentTxConfirmed,
    celebrateOnPaymentConfirmed,
    onComplimentarySuccess,
    celebrateOnComplimentary,
    afterVerifyOk,
    onVerifyPending,
  } = opts

  if (raffle.currency === 'OWL' && !isOwlEnabled()) {
    return { ok: false, error: 'OWL entry is not enabled yet — mint address pending.' }
  }

  try {
    let createResponse: Response | null = null
    let fetchRetries = 3
    let fetchError: Error | null = null

    while (fetchRetries > 0) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000)
        createResponse = await fetch('/api/entries/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            raffleId: raffle.id,
            walletAddress: publicKey.toBase58(),
            ticketQuantity,
          }),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        break
      } catch (fetchErr: unknown) {
        fetchRetries--
        fetchError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr))
        const errorMessage = fetchError.message || ''
        const errorName = (fetchErr as { name?: string })?.name || ''
        const isFetchError =
          errorMessage.includes('failed to fetch') ||
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('NetworkError') ||
          errorMessage.includes('Network request failed') ||
          errorName === 'TypeError' ||
          errorName === 'AbortError' ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('CORS') ||
          errorMessage.includes('network')

        if (fetchRetries === 0) {
          if (isFetchError || errorName === 'AbortError') {
            throw new Error(
              'Network connection failed. Please check your internet connection and try again. ' +
                'On mobile, try switching between WiFi and mobile data.'
            )
          }
          throw fetchError
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * (3 - fetchRetries)))
      }
    }

    if (!createResponse) {
      throw fetchError || new Error('Failed to create entry: Network error')
    }

    if (!createResponse.ok) {
      let errorMessage = 'Failed to create entry. Please try again.'
      try {
        const contentType = createResponse.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const errorData = (await createResponse.json()) as { error?: string }
          if (typeof errorData?.error === 'string') errorMessage = errorData.error
        }
      } catch {
        /* ignore */
      }
      throw new Error(errorMessage)
    }

    let entryId: string
    let paymentDetails: PaymentDetails

    try {
      const data = (await createResponse.json()) as {
        complimentary?: boolean
        complimentaryToken?: string
        entryId?: string
        paymentDetails?: PaymentDetails
      }
      if (data?.complimentary === true && data?.complimentaryToken && data?.entryId && publicKey) {
        const confRes = await fetch('/api/entries/confirm-complimentary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            entryId: data.entryId,
            token: data.complimentaryToken,
            walletAddress: publicKey.toBase58(),
          }),
        })
        if (!confRes.ok) {
          let msg = 'Could not activate your free referral ticket. Try again in a moment.'
          try {
            const j = (await confRes.json()) as { error?: string }
            if (typeof j?.error === 'string') msg = j.error
          } catch {
            /* ignore */
          }
          throw new Error(msg)
        }
        clearReferralComplimentarySessionCache()
        if (celebrateOnComplimentary !== false) requestAnimationFrame(() => fireGreenConfetti())
        onComplimentarySuccess?.()
        routerRefresh()
        return { ok: true }
      }
      entryId = data?.entryId as string
      paymentDetails = data?.paymentDetails as PaymentDetails
    } catch {
      throw new Error('Invalid response from server. Please try again.')
    }

    if (!entryId || !paymentDetails) {
      throw new Error('Invalid create response')
    }

    const transaction = await buildPurchaseTransactionFromPaymentDetails(
      connection,
      publicKey,
      String(raffle.currency || 'SOL'),
      paymentDetails
    )

    let signature: string
    try {
      if (transaction.instructions.length === 0) {
        throw new Error('Transaction has no instructions. Please try again.')
      }
      if (!transaction.recentBlockhash) {
        throw new Error('Transaction blockhash is missing. Please try again.')
      }

      signature = await sendTransaction(transaction, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })
    } catch (walletError: unknown) {
      const we = walletError as { message?: string; code?: number; name?: string }
      const errorMessage = we?.message || String(walletError) || 'Unknown error'
      const errorCode = we?.code
      const isUserRejection =
        errorCode === 4001 ||
        errorMessage.includes('User rejected') ||
        errorMessage.includes('rejected the request') ||
        errorMessage.includes('rejected')
      if (isUserRejection) {
        throw new Error('Transaction was cancelled. Please try again if you want to continue.')
      }

      const isMobile =
        typeof navigator !== 'undefined' &&
        /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
          navigator.userAgent || (navigator as { vendor?: string }).vendor || ''
        )
      const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '')

      if (errorMessage.includes('insufficient funds') || errorMessage.includes('Insufficient')) {
        throw new Error(
          'Insufficient funds in your wallet. Please ensure you have enough SOL/USDC to cover the transaction and fees.'
        )
      }
      if (isAndroid && (errorMessage.includes('blockhash') || errorMessage.includes('expired'))) {
        throw new Error(
          'Transaction blockhash expired. This can happen on slower connections. Please try again - the transaction will use a fresh blockhash.'
        )
      }
      if (
        isMobile &&
        (errorMessage.includes('invalid') || errorMessage.includes('Invalid') || errorMessage.includes('serialize'))
      ) {
        throw new Error(
          'Transaction validation failed. Please try: 1) Refreshing the page, 2) Reconnecting your wallet, 3) Ensuring your wallet app is up to date.'
        )
      }
      if (errorMessage.toLowerCase().includes('solflare')) {
        throw new Error(
          'Solflare wallet error. Please try: 1) Refreshing the page and reconnecting Solflare, 2) Updating the Solflare extension to the latest version, 3) Using Solflare in a different browser if the issue persists.'
        )
      }
      if (errorMessage.includes('Something went wrong') || errorMessage.includes('wallet')) {
        throw new Error(
          'Wallet extension error. Please try: 1) Refreshing the page, 2) Reconnecting your wallet, 3) Ensuring your wallet extension is up to date.'
        )
      }
      if (errorMessage.includes('Network') || errorMessage.includes('connection')) {
        throw new Error('Network error. Please check your internet connection and try again.')
      }
      if (isMobile && errorMessage.includes('timeout')) {
        throw new Error('Transaction timeout. This can happen on slower mobile connections. Please try again.')
      }
      throw new Error(`Transaction failed: ${errorMessage}. Please try again.`)
    }

    await confirmSignatureSuccessOnChain(connection, signature)

    afterPaymentTxConfirmed?.()
    if (celebrateOnPaymentConfirmed) {
      requestAnimationFrame(() => fireGreenConfetti())
    }

    const verifyResponse = await fetch('/api/entries/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId, transactionSignature: signature }),
    })

    if (verifyResponse.status === 202) {
      if (onVerifyPending) {
        await onVerifyPending({ entryId, transactionSignature: signature })
      } else {
        routerRefresh()
      }
      return { ok: true }
    }

    if (!verifyResponse.ok) {
      let errorData: { error?: string; details?: string } = {}
      try {
        const contentType = verifyResponse.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          errorData = (await verifyResponse.json()) as { error?: string; details?: string }
        }
      } catch {
        /* ignore */
      }
      const errorMessage =
        errorData.details && errorData.error
          ? `${errorData.error}: ${errorData.details}`
          : errorData.error || 'Failed to verify transaction. Please try again.'
      throw new Error(errorMessage)
    }

    routerRefresh()
    afterVerifyOk?.()
    return { ok: true }
  } catch (err: unknown) {
    const { message, isUnconfirmedPayment } = classifyPurchaseError(err)
    return { ok: false, error: message, isUnconfirmedPayment }
  }
}
