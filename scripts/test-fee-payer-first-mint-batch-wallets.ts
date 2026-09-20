/**
 * Popular-wallet allowlist for candy-machine qty > 1 (fee-payer-first signAll).
 * Run: npx tsx scripts/test-fee-payer-first-mint-batch-wallets.ts
 */
import assert from 'node:assert/strict'
import { walletNameSupportsFeePayerFirstMintBatch } from '../lib/solana/phantom-sign-and-send-transaction'

const shouldMatch = [
  'Phantom',
  'Solflare',
  'Jupiter',
  'Backpack',
  'Coinbase',
  'Trust',
  'MetaMask',
  'Solana Mobile',
  'Phantom Embedded Wallet',
  'Backpack (Mobile)',
]

const shouldNotMatch = ['', 'Ledger', 'Glow', 'Slope', 'Unknown Wallet']

for (const name of shouldMatch) {
  assert.equal(
    walletNameSupportsFeePayerFirstMintBatch(name),
    true,
    `expected fee-payer-first batch for ${name}`
  )
}

for (const name of shouldNotMatch) {
  assert.equal(
    walletNameSupportsFeePayerFirstMintBatch(name),
    false,
    `expected no name-only match for ${name}`
  )
}

console.log('ok — fee-payer-first mint batch wallet names')
