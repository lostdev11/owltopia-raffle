/**
 * Ledger-friendly SIWS fallback: sign a memo transaction (not broadcast).
 * Phantom/Solflare often never deliver off-chain signMessage to Ledger; tx signing works.
 */
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import nacl from 'tweetnacl'

/** SPL Memo program. */
export const SIGN_IN_MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

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
  tx.add(
    new TransactionInstruction({
      keys: [{ pubkey: wallet, isSigner: true, isWritable: false }],
      programId: SIGN_IN_MEMO_PROGRAM_ID,
      data: Buffer.from(params.message, 'utf8'),
    })
  )
  return tx
}

export function serializeUnsignedSignInMemoTransaction(tx: Transaction): string {
  return Buffer.from(
    tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })
  ).toString('base64')
}

/**
 * Verify a signed (unsent) memo transaction proves the wallet signed our SIWS message.
 */
export function verifySignInMemoTransaction(params: {
  wallet: string
  message: string
  signedTransactionBase64: string
}): { valid: boolean; error?: string } {
  try {
    const walletPk = new PublicKey(params.wallet)
    const raw = Buffer.from(params.signedTransactionBase64, 'base64')
    if (raw.length < 64 || raw.length > 1232) {
      return { valid: false, error: 'Invalid signed transaction size' }
    }

    const tx = Transaction.from(raw)
    if (!tx.feePayer || !tx.feePayer.equals(walletPk)) {
      return { valid: false, error: 'Fee payer mismatch' }
    }
    if (!tx.recentBlockhash || typeof tx.recentBlockhash !== 'string') {
      return { valid: false, error: 'Missing blockhash' }
    }
    if (tx.instructions.length !== 1) {
      return { valid: false, error: 'Unexpected transaction shape' }
    }

    const ix = tx.instructions[0]!
    if (!ix.programId.equals(SIGN_IN_MEMO_PROGRAM_ID)) {
      return { valid: false, error: 'Not a memo sign-in transaction' }
    }
    const memo = Buffer.from(ix.data).toString('utf8')
    if (memo !== params.message) {
      return { valid: false, error: 'Memo does not match sign-in message' }
    }

    const sigEntry = tx.signatures.find((s) => s.publicKey.equals(walletPk))
    if (!sigEntry?.signature || sigEntry.signature.length !== 64) {
      return { valid: false, error: 'Missing wallet signature' }
    }

    const messageBytes = tx.serializeMessage()
    const ok = nacl.sign.detached.verify(messageBytes, sigEntry.signature, walletPk.toBytes())
    return ok ? { valid: true } : { valid: false, error: 'Invalid transaction signature' }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return { valid: false, error: err || 'Could not verify signed transaction' }
  }
}
