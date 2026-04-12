import type { SendTransactionOptions, WalletAdapter } from '@solana/wallet-adapter-base'
import { isVersionedTransaction } from '@solana/wallet-adapter-base'
import type { Connection, TransactionSignature } from '@solana/web3.js'
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'

type PhantomSolanaLike = {
  isPhantom?: boolean
  publicKey?: PublicKey | { toBase58(): string } | null
  signAndSendTransaction?: (
    transaction: Transaction | VersionedTransaction,
    options?: {
      skipPreflight?: boolean
      preflightCommitment?: 'processed' | 'confirmed' | 'finalized'
      maxRetries?: number
      minContextSlot?: number
    }
  ) => Promise<{ signature: TransactionSignature | Uint8Array }>
}

function toBase58(pk: PublicKey | { toBase58(): string }): string {
  return pk instanceof PublicKey ? pk.toBase58() : pk.toBase58()
}

function getPhantomInjectedProviderForPublicKey(expected: PublicKey): PhantomSolanaLike | null {
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

async function prepareLegacyTransactionLikeAdapter(
  transaction: Transaction,
  connection: Connection,
  feePayer: PublicKey,
  options: SendTransactionOptions | undefined
): Promise<Transaction> {
  transaction.feePayer = transaction.feePayer || feePayer
  if (!transaction.recentBlockhash) {
    const { blockhash } = await connection.getLatestBlockhash({
      commitment: options?.preflightCommitment,
      minContextSlot: options?.minContextSlot,
    })
    transaction.recentBlockhash = blockhash
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
