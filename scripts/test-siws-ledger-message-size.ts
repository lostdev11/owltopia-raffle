/**
 * Regression: SIWS / nesting sign-in messages must stay Ledger-friendly.
 * Run: npx tsx --env-file=.env.local scripts/test-siws-ledger-message-size.ts
 * (SESSION_SECRET or AUTH_SECRET required.)
 */
import assert from 'node:assert/strict'
import nacl from 'tweetnacl'
import { Keypair } from '@solana/web3.js'
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
import { formatSignMessageError } from '../lib/solana/sign-message-error'
import { signMessageSignatureToBase64 } from '../lib/solana/sign-message-signature'

/** Solana off-chain format 0/1 hardware limit (preamble + body). Stay comfortably under. */
const LEDGER_SAFE_MESSAGE_BYTES = 900

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

  console.log(
    JSON.stringify(
      {
        ok: true,
        nonceLength: nonce.length,
        messageBytes: bytes,
        messagePreview: message.split('\n')[0],
      },
      null,
      2
    )
  )
}

main()
