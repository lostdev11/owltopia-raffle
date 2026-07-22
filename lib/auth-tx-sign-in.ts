/**
 * Ledger-friendly SIWS fallback: sign a memo transaction (not broadcast).
 * Phantom/Solflare often never deliver off-chain signMessage to Ledger; tx signing works.
 *
 * Wallets may return legacy Transaction OR VersionedTransaction, and may inject
 * ComputeBudget and Phantom Lighthouse assertion instructions — verification must accept all three.
 */
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js'
import nacl from 'tweetnacl'

/** SPL Memo program. */
export const SIGN_IN_MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

/** Compute Budget program — wallets often prepend these; ignore during verify. */
const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111')

/**
 * Phantom Blowfish / Lighthouse assertion program.
 * Wallets inject these into signed (even unsigned-for-broadcast) txs; verification must allow them.
 * @see https://docs.phantom.com/developer-powertools/lighthouse
 */
export const LIGHTHOUSE_PROGRAM_ID = new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95')

export type SignedTxInput = Transaction | VersionedTransaction

export function buildSignInMemoTransaction(params: {
  wallet: PublicKey | string
  message: string
  blockhash: string
}): Transaction {
  const wallet =
    typeof params.wallet === 'string' ? new PublicKey(params.wallet) : params.wallet
  const tx = new Transaction()
  tx.feePayer = wallet
  tx.recentBlockhash = params.blockhash
  // Empty keys — standard auth-memo pattern (matches Phantom/Solflare/Ledger examples).
  tx.add(
    new TransactionInstruction({
      keys: [],
      programId: SIGN_IN_MEMO_PROGRAM_ID,
      data: Buffer.from(params.message, 'utf8'),
    })
  )
  return tx
}

/** Serialize a wallet-signed tx (legacy or versioned) to base64 for /api/auth/verify-tx. */
export function serializeSignedSignInTransaction(signed: SignedTxInput): string {
  if (signed instanceof VersionedTransaction) {
    return Buffer.from(signed.serialize()).toString('base64')
  }

  // Some wallet adapters return a versioned-shaped object that fails `instanceof`.
  if (isVersionedTransactionLike(signed)) {
    return Buffer.from(signed.serialize()).toString('base64')
  }

  const tx = signed as Transaction
  return Buffer.from(
    tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })
  ).toString('base64')
}

function isVersionedTransactionLike(
  signed: SignedTxInput
): signed is VersionedTransaction {
  if (signed instanceof VersionedTransaction) return true
  if (signed instanceof Transaction) return false
  const candidate = signed as unknown as {
    message?: unknown
    signatures?: unknown
    serialize?: unknown
    feePayer?: unknown
  }
  return (
    candidate != null &&
    typeof candidate === 'object' &&
    'message' in candidate &&
    'signatures' in candidate &&
    typeof candidate.serialize === 'function' &&
    !('feePayer' in candidate)
  )
}

/** @deprecated use serializeSignedSignInTransaction */
export function serializeUnsignedSignInMemoTransaction(tx: Transaction): string {
  return serializeSignedSignInTransaction(tx)
}

function isComputeBudgetIx(programId: PublicKey): boolean {
  return programId.equals(COMPUTE_BUDGET_PROGRAM_ID)
}

/** Wallet-injected ixs that do not affect the SIWS memo proof. */
function isBenignWalletInjectedIx(programId: PublicKey): boolean {
  return isComputeBudgetIx(programId) || programId.equals(LIGHTHOUSE_PROGRAM_ID)
}

function memoUtf8FromIxData(data: Uint8Array | Buffer): string {
  return Buffer.from(data).toString('utf8')
}

function verifyEd25519(
  messageBytes: Uint8Array,
  signature: Uint8Array,
  publicKey: PublicKey
): boolean {
  if (signature.length !== 64) return false
  return nacl.sign.detached.verify(messageBytes, signature, publicKey.toBytes())
}

function verifyLegacySignedMemo(params: {
  walletPk: PublicKey
  message: string
  raw: Buffer
}): { valid: boolean; error?: string } {
  const tx = Transaction.from(params.raw)
  if (!tx.feePayer || !tx.feePayer.equals(params.walletPk)) {
    return { valid: false, error: 'Fee payer mismatch' }
  }
  if (!tx.recentBlockhash || typeof tx.recentBlockhash !== 'string') {
    return { valid: false, error: 'Missing blockhash' }
  }

  const memoIxs = tx.instructions.filter((ix) => ix.programId.equals(SIGN_IN_MEMO_PROGRAM_ID))
  if (memoIxs.length !== 1) {
    return {
      valid: false,
      error: `Expected exactly one memo instruction (found ${memoIxs.length})`,
    }
  }
  for (const ix of tx.instructions) {
    if (ix.programId.equals(SIGN_IN_MEMO_PROGRAM_ID)) continue
    if (isBenignWalletInjectedIx(ix.programId)) continue
    return { valid: false, error: `Unexpected instruction: ${ix.programId.toBase58()}` }
  }

  const memo = memoUtf8FromIxData(memoIxs[0]!.data)
  if (memo !== params.message) {
    return { valid: false, error: 'Memo does not match sign-in message' }
  }

  const sigEntry = tx.signatures.find((s) => s.publicKey.equals(params.walletPk))
  if (!sigEntry?.signature || sigEntry.signature.length !== 64) {
    return { valid: false, error: 'Missing wallet signature' }
  }

  const messageBytes = tx.serializeMessage()
  const ok = verifyEd25519(messageBytes, sigEntry.signature, params.walletPk)
  return ok ? { valid: true } : { valid: false, error: 'Invalid transaction signature' }
}

function verifyVersionedSignedMemo(params: {
  walletPk: PublicKey
  message: string
  raw: Buffer
}): { valid: boolean; error?: string } {
  const vtx = VersionedTransaction.deserialize(params.raw)
  const accountKeys = vtx.message.getAccountKeys()
  const feePayer = accountKeys.get(0)
  if (!feePayer || !feePayer.equals(params.walletPk)) {
    return { valid: false, error: 'Fee payer mismatch' }
  }

  const compiled = vtx.message.compiledInstructions
  let memoCount = 0
  let memoText: string | null = null

  for (const ix of compiled) {
    const programId = accountKeys.get(ix.programIdIndex)
    if (!programId) {
      return { valid: false, error: 'Invalid instruction program id' }
    }
    if (programId.equals(SIGN_IN_MEMO_PROGRAM_ID)) {
      memoCount += 1
      memoText = memoUtf8FromIxData(ix.data)
      continue
    }
    if (isBenignWalletInjectedIx(programId)) continue
    return { valid: false, error: `Unexpected instruction: ${programId.toBase58()}` }
  }

  if (memoCount !== 1 || memoText == null) {
    return { valid: false, error: `Expected exactly one memo instruction (found ${memoCount})` }
  }
  if (memoText !== params.message) {
    return { valid: false, error: 'Memo does not match sign-in message' }
  }

  // Fee payer is always the first required signer (index 0).
  const signature = vtx.signatures[0]
  if (!signature || signature.length !== 64 || signature.every((b) => b === 0)) {
    return { valid: false, error: 'Missing wallet signature' }
  }

  const messageBytes = vtx.message.serialize()
  const ok = verifyEd25519(messageBytes, signature, params.walletPk)
  return ok ? { valid: true } : { valid: false, error: 'Invalid transaction signature' }
}

function looksLikeVersionedTransaction(raw: Buffer): boolean {
  // Legacy wire: shortvec(numSignatures) then 64*n signature bytes then message starting with
  // numRequiredSignatures (u8). Versioned messages set the high bit of the first message byte.
  // Heuristic used by wallets: try versioned deserialize when legacy fails, or peek prefix.
  try {
    VersionedTransaction.deserialize(raw)
    // Also try legacy — if both work, prefer whichever verifies; caller tries legacy first.
    return true
  } catch {
    return false
  }
}

/**
 * Verify a signed (unsent) memo transaction proves the wallet signed our SIWS message.
 * Accepts legacy Transaction and VersionedTransaction wire formats from Phantom/Solflare/Ledger.
 */
export function verifySignInMemoTransaction(params: {
  wallet: string
  message: string
  signedTransactionBase64: string
}): { valid: boolean; error?: string } {
  try {
    const walletPk = new PublicKey(params.wallet)
    const raw = Buffer.from(params.signedTransactionBase64, 'base64')
    // Versioned + compute-budget signed txs can exceed legacy packet comfort size.
    if (raw.length < 64 || raw.length > 4096) {
      return { valid: false, error: `Invalid signed transaction size (${raw.length})` }
    }

    // Prefer legacy parse first (our client builds legacy). Fall back to versioned.
    let legacyError: string | undefined
    try {
      const legacy = verifyLegacySignedMemo({ walletPk, message: params.message, raw })
      if (legacy.valid) return legacy
      legacyError = legacy.error
    } catch (e) {
      legacyError = e instanceof Error ? e.message : String(e)
    }

    if (looksLikeVersionedTransaction(raw)) {
      try {
        const versioned = verifyVersionedSignedMemo({ walletPk, message: params.message, raw })
        if (versioned.valid) return versioned
        return {
          valid: false,
          error: versioned.error || legacyError || 'Invalid signed transaction',
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        return {
          valid: false,
          error: legacyError ? `${legacyError}; versioned: ${err}` : err,
        }
      }
    }

    return { valid: false, error: legacyError || 'Could not parse signed transaction' }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return { valid: false, error: err || 'Could not verify signed transaction' }
  }
}
