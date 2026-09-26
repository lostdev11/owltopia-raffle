'use client'

import {
  Transaction,
  VersionedTransaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  type Connection,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import type { SendTransactionOptions } from '@solana/wallet-adapter-base'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { owlUiToRawBigint } from '@/lib/council/owl-amount-format'
import {
  PACK_PRICE_OWL,
  type PackPaymentCurrency,
} from '@/lib/packs/config'
import {
  friendlyPackPaymentError,
  insufficientPackOwlMessage,
  insufficientPackSolMessage,
  isPackPriceMismatch,
  PACK_PAYMENT_FEE_BUFFER_LAMPORTS,
  packPaymentLamportsNeeded,
  packPriceMismatchMessage,
} from '@/lib/packs/pack-purchase-errors'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

export type PackOpenClientResult = {
  openId: string
  category: string
  prizeLabel: string
  owlAmount: number | null
  solAmount: number | null
  nftMint: string | null
  nftName: string | null
  nftImageUrl: string | null
  freeTicketCredits: number
  payoutSignature: string | null
  openSeed: string
  openCommitHash: string
  revealMessage: string
  isJackpotWin?: boolean
  jackpotAmountSol?: number | null
  jackpotPoolSol?: number | null
}

export type ExecutePackPurchaseOptions = {
  publicKey: PublicKey
  connection: Connection
  sendTransaction: (
    tx: Transaction | VersionedTransaction,
    c: Connection,
    opts?: SendTransactionOptions
  ) => Promise<string>
  currency?: PackPaymentCurrency
  /**
   * Price shown on the packs page. Used to pre-check balance before creating a
   * pending open, and to catch UI vs checkout price drift.
   */
  expectedPriceSol?: number
  expectedPriceOwl?: number
  /** Fires after on-chain payment confirms — UI may show “resolving prize…” here. */
  onPaymentConfirmed?: (info: {
    openId: string
    paymentSignature: string
  }) => void
}

/** Client abort for /api/packs/open — under route maxDuration (120s) so UI never spins forever. */
export const PACK_OPEN_CLIENT_TIMEOUT_MS = 110_000

/** Faster payment confirmation polling before server VRF work starts. */
export const PACK_PAYMENT_CONFIRM_POLL_MS = 300

export const PACK_OPEN_CLIENT_TIMEOUT_MESSAGE =
  'Prize resolution timed out after payment. Your pack is queued for support/refund — contact support with your payment signature.'

async function confirmPackOpen(input: {
  openId: string
  wallet: string
  paymentSignature: string
}): Promise<{ ok: true; result: PackOpenClientResult } | { ok: false; error: string }> {
  const maxAttempts = 4
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PACK_OPEN_CLIENT_TIMEOUT_MS)
    try {
      const openRes = await fetch('/api/packs/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openId: input.openId,
          wallet: input.wallet,
          paymentSignature: input.paymentSignature,
        }),
        signal: controller.signal,
      })
      const openData = await openRes.json().catch(() => ({}))
      if (openRes.status === 503 && openData.retryable && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1) + Math.random() * 400))
        continue
      }
      if (!openRes.ok) {
        return { ok: false, error: openData.error || 'Pack open failed after payment' }
      }
      return { ok: true, result: openData.result as PackOpenClientResult }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return { ok: false, error: PACK_OPEN_CLIENT_TIMEOUT_MESSAGE }
      }
      if (attempt >= maxAttempts - 1) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : 'Pack open failed after payment',
        }
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    } finally {
      clearTimeout(timeoutId)
    }
  }
  return { ok: false, error: 'Pack open failed after payment' }
}

async function readBalanceLamports(
  connection: Connection,
  publicKey: PublicKey
): Promise<number | null> {
  try {
    return await connection.getBalance(publicKey, 'confirmed')
  } catch {
    return null
  }
}

async function tokenProgramHoldingMint(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID> {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        owner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const account = await getAccount(connection, ata, 'confirmed', programId)
      if (account.amount > 0n) return programId
    } catch {
      // try next
    }
  }
  return TOKEN_PROGRAM_ID
}

async function buildOwlCheckoutTx(input: {
  connection: Connection
  publicKey: PublicKey
  vault: string
  priceOwl: number
  feeLamports: number
}): Promise<{ ok: true; tx: Transaction } | { ok: false; error: string }> {
  if (!isOwlEnabled()) {
    return { ok: false, error: '$OWL is not configured on this site.' }
  }
  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) {
    return { ok: false, error: 'OWL mint address missing.' }
  }
  if (!(input.priceOwl > 0) || !(input.feeLamports > 0)) {
    return { ok: false, error: 'Invalid $OWL checkout amounts.' }
  }

  let vaultPk: PublicKey
  try {
    vaultPk = new PublicKey(input.vault)
  } catch {
    return { ok: false, error: 'Invalid packs vault address.' }
  }

  const mint = new PublicKey(owl.mintAddress)
  const amountRaw = owlUiToRawBigint(input.priceOwl, owl.decimals)
  const programId = await tokenProgramHoldingMint(input.connection, input.publicKey, mint)

  const senderAta = await getAssociatedTokenAddress(
    mint,
    input.publicKey,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const recipientAta = await getAssociatedTokenAddress(
    mint,
    vaultPk,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  try {
    const senderAcc = await getAccount(input.connection, senderAta, 'confirmed', programId)
    if (senderAcc.amount < amountRaw) {
      const have = Number(senderAcc.amount) / 10 ** owl.decimals
      return {
        ok: false,
        error: insufficientPackOwlMessage({
          priceOwl: input.priceOwl,
          haveOwl: have,
          feeSol: input.feeLamports / LAMPORTS_PER_SOL,
        }),
      }
    }
  } catch {
    return { ok: false, error: 'No $OWL token account in this wallet for the configured mint.' }
  }

  const { blockhash } = await input.connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: input.publicKey })

  try {
    await getAccount(input.connection, recipientAta, 'confirmed', programId)
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        input.publicKey,
        recipientAta,
        vaultPk,
        mint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }

  tx.add(createTransferInstruction(senderAta, recipientAta, input.publicKey, amountRaw, [], programId))
  tx.add(
    SystemProgram.transfer({
      fromPubkey: input.publicKey,
      toPubkey: vaultPk,
      lamports: input.feeLamports,
    })
  )

  return { ok: true, tx }
}

export async function executePackPurchase(
  opts: ExecutePackPurchaseOptions
): Promise<{ ok: true; result: PackOpenClientResult } | { ok: false; error: string }> {
  const wallet = opts.publicKey.toBase58()
  const currency: PackPaymentCurrency = opts.currency === 'OWL' ? 'OWL' : 'SOL'
  let balanceLamports = await readBalanceLamports(opts.connection, opts.publicKey)
  const expectedPriceSol =
    opts.expectedPriceSol && opts.expectedPriceSol > 0 ? opts.expectedPriceSol : null

  if (currency === 'SOL' && expectedPriceSol != null && balanceLamports != null) {
    const needed = packPaymentLamportsNeeded(expectedPriceSol)
    if (balanceLamports < needed) {
      return {
        ok: false,
        error: insufficientPackSolMessage({
          priceSol: expectedPriceSol,
          balanceLamports,
        }),
      }
    }
  }

  const createRes = await fetch('/api/packs/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, currency }),
  })
  const createData = await createRes.json().catch(() => ({}))
  if (!createRes.ok) {
    return { ok: false, error: createData.error || 'Could not start pack open' }
  }

  const openId = createData.openId as string
  const priceSol = Number(createData.priceSol)
  const vault = createData.vault as string
  if (!openId || !vault || !(priceSol > 0)) {
    return { ok: false, error: 'Invalid pack create response' }
  }

  if (currency === 'SOL') {
    if (expectedPriceSol != null && isPackPriceMismatch(expectedPriceSol, priceSol)) {
      return { ok: false, error: packPriceMismatchMessage(expectedPriceSol, priceSol) }
    }

    if (balanceLamports == null) {
      balanceLamports = await readBalanceLamports(opts.connection, opts.publicKey)
    }
    if (balanceLamports != null) {
      const needed = packPaymentLamportsNeeded(priceSol)
      if (balanceLamports < needed) {
        return {
          ok: false,
          error: insufficientPackSolMessage({
            priceSol,
            balanceLamports,
          }),
        }
      }
    }

    const lamports = Math.round(priceSol * LAMPORTS_PER_SOL)
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: opts.publicKey,
        toPubkey: new PublicKey(vault),
        lamports,
      })
    )

    let signature: string
    try {
      signature = await opts.sendTransaction(tx, opts.connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
    } catch (e) {
      return {
        ok: false,
        error: friendlyPackPaymentError(e, {
          priceSol,
          balanceLamports: balanceLamports ?? undefined,
        }),
      }
    }

    try {
      await confirmSignatureSuccessOnChain(
        opts.connection,
        signature,
        120_000,
        undefined,
        { pollIntervalMs: PACK_PAYMENT_CONFIRM_POLL_MS }
      )
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? e.message
            : 'Payment sent but confirmation timed out — contact support with your signature',
      }
    }

    opts.onPaymentConfirmed?.({ openId, paymentSignature: signature })
    return confirmPackOpen({ openId, wallet, paymentSignature: signature })
  }

  // OWL path
  const priceOwl = Number(createData.priceOwl) || PACK_PRICE_OWL
  const feeLamports = Number(createData.feeLamports)
  const feeSol = Number(createData.feeSol)
  if (!(priceOwl > 0) || !(feeLamports > 0)) {
    return { ok: false, error: 'Invalid $OWL checkout quote from server' }
  }

  if (
    opts.expectedPriceOwl != null &&
    opts.expectedPriceOwl > 0 &&
    Math.abs(opts.expectedPriceOwl - priceOwl) >= 0.001
  ) {
    return {
      ok: false,
      error: `Pack $OWL price changed (page showed ${opts.expectedPriceOwl}, checkout needs ${priceOwl}). Refresh and try again.`,
    }
  }

  if (balanceLamports == null) {
    balanceLamports = await readBalanceLamports(opts.connection, opts.publicKey)
  }
  const feeNeeded = feeLamports + PACK_PAYMENT_FEE_BUFFER_LAMPORTS
  if (balanceLamports != null && balanceLamports < feeNeeded) {
    return {
      ok: false,
      error: insufficientPackOwlMessage({
        priceOwl,
        haveOwl: null,
        feeSol: feeSol > 0 ? feeSol : feeLamports / LAMPORTS_PER_SOL,
        balanceLamports,
      }),
    }
  }

  const built = await buildOwlCheckoutTx({
    connection: opts.connection,
    publicKey: opts.publicKey,
    vault,
    priceOwl,
    feeLamports: Math.floor(feeLamports),
  })
  if (!built.ok) return built

  let signature: string
  try {
    signature = await opts.sendTransaction(built.tx, opts.connection, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
  } catch (e) {
    return {
      ok: false,
      error: friendlyPackPaymentError(e, {
        priceSol: feeSol > 0 ? feeSol : feeLamports / LAMPORTS_PER_SOL,
        balanceLamports: balanceLamports ?? undefined,
        priceOwl,
      }),
    }
  }

  try {
    await confirmSignatureSuccessOnChain(
      opts.connection,
      signature,
      120_000,
      undefined,
      { pollIntervalMs: PACK_PAYMENT_CONFIRM_POLL_MS }
    )
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : 'Payment sent but confirmation timed out — contact support with your signature',
    }
  }

  opts.onPaymentConfirmed?.({ openId, paymentSignature: signature })
  return confirmPackOpen({ openId, wallet, paymentSignature: signature })
}
