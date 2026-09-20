import type { SendTransactionOptions, WalletAdapter } from '@solana/wallet-adapter-base'
import { isVersionedTransaction } from '@solana/wallet-adapter-base'
import type { Connection, TransactionSignature } from '@solana/web3.js'
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  assertTransactionSimulatesClean,
  isPhantomPresimulateError,
} from '@/lib/solana/phantom-presimulate'

type PhantomSendOptions = {
  skipPreflight?: boolean
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized'
  maxRetries?: number
  minContextSlot?: number
}

type PhantomSolanaLike = {
  isPhantom?: boolean
  publicKey?: PublicKey | { toBase58(): string } | null
  signAndSendTransaction?: (
    transaction: Transaction | VersionedTransaction,
    options?: PhantomSendOptions
  ) => Promise<{ signature: TransactionSignature | Uint8Array }>
  signAndSendAllTransactions?: (
    transactions: (Transaction | VersionedTransaction)[],
    options?: PhantomSendOptions
  ) => Promise<{
    signatures: Array<TransactionSignature | Uint8Array>
    publicKey?: PublicKey | { toBase58(): string }
  }>
}

function toBase58(pk: PublicKey | { toBase58(): string }): string {
  return pk instanceof PublicKey ? pk.toBase58() : pk.toBase58()
}

export function getPhantomInjectedProviderForPublicKey(expected: PublicKey): PhantomSolanaLike | null {
  if (typeof window === 'undefined') return null
  const want = expected.toBase58()
  const candidates: unknown[] = [(window as unknown as { phantom?: { solana?: unknown } }).phantom?.solana]
  const sol = (window as unknown as { solana?: unknown }).solana
  if (sol) candidates.push(sol)
  for (const c of candidates) {
    const p = c as PhantomSolanaLike | null | undefined
    if (!p?.isPhantom || typeof p.signAndSendTransaction !== 'function') continue
    const pk = p.publicKey
    if (!pk) continue
    if (toBase58(pk as PublicKey | { toBase58(): string }) === want) return p
  }
  return null
}

function adapterIsPhantom(adapter: WalletAdapter): boolean {
  const n = String(adapter.name).toLowerCase()
  return n === 'phantom' || n.includes('phantom')
}

function adapterIsSolflare(adapter: WalletAdapter): boolean {
  const n = String(adapter.name).toLowerCase()
  return n === 'solflare' || n.includes('solflare')
}

function adapterIsJupiter(adapter: WalletAdapter): boolean {
  const n = String(adapter.name).toLowerCase()
  return n === 'jupiter' || n.includes('jupiter')
}

/**
 * Popular wallets we ship (see docs/WALLETS.md). Candy Machine qty > 1 needs fee-payer-first
 * `signAllTransactions` so mobile does not only land the first mint.
 */
const POPULAR_FEE_PAYER_FIRST_MINT_BATCH_NAMES = [
  'phantom',
  'solflare',
  'jupiter',
  'backpack',
  'coinbase',
  'trust',
  'metamask',
  'solana mobile',
] as const

/** Exported for unit tests — name-only popular-wallet check. */
export function walletNameSupportsFeePayerFirstMintBatch(walletName: string): boolean {
  const n = walletName.trim().toLowerCase()
  if (!n) return false
  return POPULAR_FEE_PAYER_FIRST_MINT_BATCH_NAMES.some((w) => n === w || n.includes(w))
}

type SignAllCapableAdapter = WalletAdapter & {
  signAllTransactions?: (transactions: unknown[]) => Promise<unknown[]>
}

async function prepareLegacyTransactionLikeAdapter(
  transaction: Transaction,
  connection: Connection,
  feePayer: PublicKey,
  options: SendTransactionOptions | undefined
): Promise<Transaction> {
  transaction.feePayer = transaction.feePayer || feePayer
  if (!transaction.recentBlockhash) {
    // Prefer processed — faster and enough for wallet prompt; avoid hanging on confirmed.
    const commitment = options?.preflightCommitment === 'finalized' ? 'confirmed' : 'processed'
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      const { blockhash } = await Promise.race([
        connection.getLatestBlockhash({
          commitment,
          minContextSlot: options?.minContextSlot,
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Timed out fetching blockhash. Check WiFi/mobile data and try again.')),
            12_000
          )
        }),
      ])
      transaction.recentBlockhash = blockhash
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }
  return transaction
}

function normalizeSignature(sig: TransactionSignature | Uint8Array): string {
  if (typeof sig === 'string') return sig
  if (sig instanceof Uint8Array) return bs58.encode(sig)
  return String(sig)
}

export type SendTransactionPreferPhantomParams = {
  transaction: Transaction | VersionedTransaction
  connection: Connection
  options?: SendTransactionOptions
  adapter: WalletAdapter
  publicKey: PublicKey | null
  fallbackSendTransaction: (
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendTransactionOptions
  ) => Promise<TransactionSignature>
}

/**
 * When Phantom is the active wallet, prefer the injected provider's
 * `signAndSendTransaction` (Phantom + Blowfish Lighthouse path). Other wallets
 * and all fallbacks use the wallet adapter's `sendTransaction`.
 *
 * Skips the Phantom shortcut if `options.signers` is non-empty (partial signers).
 */
export async function sendTransactionPreferPhantomSignAndSend(
  params: SendTransactionPreferPhantomParams
): Promise<TransactionSignature> {
  const { transaction, connection, options, adapter, publicKey, fallbackSendTransaction } = params
  const signers = options?.signers
  if (
    publicKey &&
    adapterIsPhantom(adapter) &&
    (!signers || signers.length === 0)
  ) {
    const provider = getPhantomInjectedProviderForPublicKey(publicKey)
    if (provider?.signAndSendTransaction) {
      try {
        let tx: Transaction | VersionedTransaction = transaction
        if (!isVersionedTransaction(transaction)) {
          tx = await prepareLegacyTransactionLikeAdapter(
            transaction,
            connection,
            publicKey,
            options
          )
        }
        // Phantom docs: pre-sim with sigVerify:false so doomed txs do not look "malicious".
        await assertTransactionSimulatesClean(connection, tx)
        const preflight = options?.preflightCommitment as
          | 'processed'
          | 'confirmed'
          | 'finalized'
          | undefined
        const { signature } = await provider.signAndSendTransaction(tx, {
          skipPreflight: options?.skipPreflight,
          preflightCommitment: preflight,
          maxRetries: options?.maxRetries,
          minContextSlot: options?.minContextSlot,
        })
        return normalizeSignature(signature)
      } catch (err) {
        // Doomed txs must not fall through to another wallet prompt (still looks "malicious").
        if (isPhantomPresimulateError(err)) throw err
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            '[sendTransactionPreferPhantomSignAndSend] Phantom signAndSendTransaction failed; using adapter.',
            err
          )
        }
      }
    }
  }
  return fallbackSendTransaction(transaction, connection, options)
}

export type SendAllTransactionsPreferPhantomParams = {
  transactions: Array<Transaction | VersionedTransaction>
  connection: Connection
  options?: SendTransactionOptions
  adapter: WalletAdapter
  publicKey: PublicKey | null
  /** Per-tx fallback when Phantom signAndSendAll is unavailable. */
  fallbackSendTransaction: (
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendTransactionOptions
  ) => Promise<TransactionSignature>
}

/**
 * Prefer Phantom `signAndSendAllTransactions` (Blowfish Lighthouse path) for a batch.
 * Falls back to sequential `sendTransactionPreferPhantomSignAndSend` when unavailable.
 */
export async function sendAllTransactionsPreferPhantomSignAndSend(
  params: SendAllTransactionsPreferPhantomParams
): Promise<TransactionSignature[]> {
  const { transactions, connection, options, adapter, publicKey, fallbackSendTransaction } = params
  if (transactions.length === 0) return []

  const signers = options?.signers
  if (
    publicKey &&
    adapterIsPhantom(adapter) &&
    (!signers || signers.length === 0)
  ) {
    const provider = getPhantomInjectedProviderForPublicKey(publicKey)
    if (provider?.signAndSendAllTransactions) {
      try {
        const prepared: Array<Transaction | VersionedTransaction> = []
        for (const transaction of transactions) {
          if (!isVersionedTransaction(transaction)) {
            prepared.push(
              await prepareLegacyTransactionLikeAdapter(
                transaction,
                connection,
                publicKey,
                options
              )
            )
          } else {
            prepared.push(transaction)
          }
        }
        for (const tx of prepared) {
          await assertTransactionSimulatesClean(connection, tx)
        }
        const preflight = options?.preflightCommitment as
          | 'processed'
          | 'confirmed'
          | 'finalized'
          | undefined
        const { signatures } = await provider.signAndSendAllTransactions(prepared, {
          skipPreflight: options?.skipPreflight,
          preflightCommitment: preflight,
          maxRetries: options?.maxRetries,
          minContextSlot: options?.minContextSlot,
        })
        return signatures.map(normalizeSignature)
      } catch (err) {
        if (isPhantomPresimulateError(err)) throw err
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            '[sendAllTransactionsPreferPhantomSignAndSend] Phantom signAndSendAll failed; using per-tx send.',
            err
          )
        }
      }
    }
  }

  const out: TransactionSignature[] = []
  for (const transaction of transactions) {
    out.push(
      await sendTransactionPreferPhantomSignAndSend({
        transaction,
        connection,
        options,
        adapter,
        publicKey,
        fallbackSendTransaction,
      })
    )
  }
  return out
}

/** True when the connected adapter is Phantom (name check). */
export function walletAdapterIsPhantom(adapter: WalletAdapter | null | undefined): boolean {
  return Boolean(adapter && adapterIsPhantom(adapter))
}

/** True when the connected adapter is Solflare (name check). */
export function walletAdapterIsSolflare(adapter: WalletAdapter | null | undefined): boolean {
  return Boolean(adapter && adapterIsSolflare(adapter))
}

/** True when the connected adapter is Jupiter (name check). */
export function walletAdapterIsJupiter(adapter: WalletAdapter | null | undefined): boolean {
  return Boolean(adapter && adapterIsJupiter(adapter))
}

/**
 * Candy Machine multi-mint: `signAllTransactions` with fee payer only → mint keypairs → broadcast.
 * Used for popular wallets (Phantom, Solflare, Jupiter, Backpack, Coinbase, Trust, MetaMask,
 * Solana Mobile) and any adapter that exposes `signAllTransactions`, so qty > 1 works on mobile.
 */
export function walletSupportsFeePayerFirstMintBatch(
  adapter: WalletAdapter | null | undefined
): boolean {
  if (!adapter) return false
  if (walletNameSupportsFeePayerFirstMintBatch(String(adapter.name))) return true
  return typeof (adapter as SignAllCapableAdapter).signAllTransactions === 'function'
}
