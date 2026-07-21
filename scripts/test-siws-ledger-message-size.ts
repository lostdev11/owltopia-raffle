/**
 * Regression: SIWS / nesting sign-in messages must stay Ledger-friendly,
 * and memo-tx fallback must verify for hardware wallets that cannot signMessage.
 * Run: npx tsx --env-file=.env.local scripts/test-siws-ledger-message-size.ts
 * (SESSION_SECRET or AUTH_SECRET required.)
 */
import assert from 'node:assert/strict'
import nacl from 'tweetnacl'
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  buildSignInMessage,
  consumeNonce,
  generateNonce,
  messageMatchesIssuedSignIn,
  parseNonceFromSignInMessage,
  parseValidatedNonce,
  peekSignInNonceVersion,
  verifySignIn,
} from '../lib/auth-server'
import {
  buildSignInMemoTransaction,
  serializeSignedSignInTransaction,
  SIGN_IN_MEMO_PROGRAM_ID,
  verifySignInMemoTransaction,
} from '../lib/auth-tx-sign-in'
import { formatSignMessageError } from '../lib/solana/sign-message-error'
import { signMessageSignatureToBase64 } from '../lib/solana/sign-message-signature'

/** Solana off-chain format 0/1 hardware limit (preamble + body). Stay comfortably under. */
const LEDGER_SAFE_MESSAGE_BYTES = 900

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111')

function main() {
  if (!process.env.SESSION_SECRET && !process.env.AUTH_SECRET) {
    process.env.SESSION_SECRET = 'test-session-secret-for-siws-ledger-checks'
  }

  const kp = Keypair.generate()
  const wallet = kp.publicKey.toBase58()
  const expiresAtMs = Date.now() + 5 * 60 * 1000
  const nonce = generateNonce(wallet, expiresAtMs)

  assert.equal(peekSignInNonceVersion(nonce), 2, 'new nonces must be v2 compact')
  assert.ok(nonce.length < 120, `compact nonce should be short, got ${nonce.length}`)

  const payload = parseValidatedNonce(nonce, wallet)
  assert.ok(payload, 'v2 nonce must validate')
  assert.equal(payload!.v, 2)
  assert.ok(consumeNonce(nonce, wallet))

  const message = buildSignInMessage(wallet, nonce, new Date(expiresAtMs))
  const bytes = Buffer.byteLength(message, 'utf8')
  assert.ok(
    bytes <= LEDGER_SAFE_MESSAGE_BYTES,
    `SIWS message too large for Ledger comfort: ${bytes} bytes (limit ${LEDGER_SAFE_MESSAGE_BYTES})`
  )
  assert.ok(
    [...message].every((c) => {
      const code = c.charCodeAt(0)
      return c === '\n' || (code >= 0x20 && code <= 0x7e)
    }),
    'message must be printable ASCII (+ newlines)'
  )

  assert.equal(parseNonceFromSignInMessage(message), nonce)
  assert.ok(messageMatchesIssuedSignIn(wallet, message, nonce))

  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)
  const signatureBase64 = signMessageSignatureToBase64(sig)
  const verified = verifySignIn(wallet, message, signatureBase64)
  assert.equal(verified.valid, true, verified.error)

  // Wrong wallet HMAC must fail
  assert.equal(parseValidatedNonce(nonce, Keypair.generate().publicKey.toBase58()), null)

  const ledgerErr = formatSignMessageError(new Error('Unexpected error'), {
    walletName: 'Phantom',
    context: 'sign-in',
  })
  assert.ok(ledgerErr.toLowerCase().includes('ledger') || ledgerErr.toLowerCase().includes('blind'), ledgerErr)

  const rejectErr = formatSignMessageError(new Error('User rejected the request'), { context: 'sign-in' })
  assert.equal(rejectErr, 'Sign-in cancelled in wallet.')

  const phantomCancel = formatSignMessageError(new Error('Transaction cancelled'), {
    walletName: 'Phantom',
    context: 'sign-in',
  })
  assert.ok(
    phantomCancel.toLowerCase().includes('ledger') || phantomCancel.toLowerCase().includes('sign with ledger'),
    phantomCancel
  )
  assert.ok(!phantomCancel.toLowerCase().startsWith('transaction cancelled'), phantomCancel)

  // Memo-tx fallback (Ledger path): legacy signed memo, do not broadcast.
  const fakeBlockhash = Keypair.generate().publicKey.toBase58()
  const tx = buildSignInMemoTransaction({ wallet: kp.publicKey, message, blockhash: fakeBlockhash })
  tx.partialSign(kp)
  const signedB64 = serializeSignedSignInTransaction(tx)
  const txOk = verifySignInMemoTransaction({
    wallet,
    message,
    signedTransactionBase64: signedB64,
  })
  assert.equal(txOk.valid, true, txOk.error)

  const txBad = verifySignInMemoTransaction({
    wallet,
    message: message + ' tampered',
    signedTransactionBase64: signedB64,
  })
  assert.equal(txBad.valid, false)

  // Solflare/Phantom often return VersionedTransaction + ComputeBudget — must still verify.
  const setCuLimit = new TransactionInstruction({
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data: Buffer.from([2, 0x40, 0x0d, 0x03, 0x00]), // SetComputeUnitLimit-ish bytes (shape only)
  })
  const memoIx = new TransactionInstruction({
    keys: [],
    programId: SIGN_IN_MEMO_PROGRAM_ID,
    data: Buffer.from(message, 'utf8'),
  })
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: fakeBlockhash,
    instructions: [setCuLimit, memoIx],
  }).compileToV0Message()
  const vtx = new VersionedTransaction(msg)
  vtx.sign([kp])
  const vtxB64 = serializeSignedSignInTransaction(vtx)
  const vtxOk = verifySignInMemoTransaction({
    wallet,
    message,
    signedTransactionBase64: vtxB64,
  })
  assert.equal(vtxOk.valid, true, vtxOk.error)

  console.log(
    JSON.stringify(
      {
        ok: true,
        nonceLength: nonce.length,
        messageBytes: bytes,
        messagePreview: message.split('\n')[0],
        memoTxFallback: true,
        versionedWithComputeBudget: true,
      },
      null,
      2
    )
  )
}

main()
