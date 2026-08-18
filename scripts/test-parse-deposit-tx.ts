/**
 * Unit tests for deposit-tx mint attribution (token-balance diffs + instruction collection).
 * Run: npx tsx scripts/test-parse-deposit-tx.ts
 */
import assert from 'node:assert/strict'
import {
  collectDepositTxInstructions,
  mintsCreditedToOwnerFromTokenBalances,
  pickNftMintFromEscrowCredits,
  resolveDepositMintFromCredits,
} from '../lib/solana/parse-deposit-tx'

const ESCROW = 'Escrow1111111111111111111111111111111111111'
const MINT_A = 'MintA11111111111111111111111111111111111111'
const MINT_B = 'MintB11111111111111111111111111111111111111'

// --- token balance attribution (primary fix for multi-NFT escrow verify) ---

{
  const credits = mintsCreditedToOwnerFromTokenBalances(
    {
      preTokenBalances: [],
      postTokenBalances: [
        {
          mint: MINT_A,
          owner: ESCROW,
          uiTokenAmount: { amount: '1' },
        },
      ],
    },
    ESCROW
  )
  assert.deepEqual(credits, [{ mint: MINT_A, amount: 1n }])
  assert.equal(pickNftMintFromEscrowCredits(credits), MINT_A)
}

{
  // New escrow ATA: pre empty, post amount 1 — classic Token Metadata / SPL deposit.
  const credits = mintsCreditedToOwnerFromTokenBalances(
    {
      preTokenBalances: [
        {
          mint: MINT_B,
          owner: ESCROW,
          uiTokenAmount: { amount: '1' },
        },
      ],
      postTokenBalances: [
        {
          mint: MINT_B,
          owner: ESCROW,
          uiTokenAmount: { amount: '1' },
        },
        {
          mint: MINT_A,
          owner: ESCROW,
          uiTokenAmount: { amount: '1' },
        },
      ],
    },
    ESCROW
  )
  assert.equal(credits.length, 1)
  assert.equal(credits[0]!.mint, MINT_A)
  assert.equal(pickNftMintFromEscrowCredits(credits), MINT_A)
}

{
  // Preferred mint among ambiguous multi-NFT credits in one tx.
  const credits = [
    { mint: MINT_A, amount: 1n },
    { mint: MINT_B, amount: 1n },
  ]
  assert.equal(pickNftMintFromEscrowCredits(credits), null)
  assert.equal(resolveDepositMintFromCredits(credits, MINT_B), MINT_B)
  assert.equal(resolveDepositMintFromCredits(credits, null), null)
}

{
  // Fungible credit alone is still attributable when sole credit.
  const credits = mintsCreditedToOwnerFromTokenBalances(
    {
      preTokenBalances: [],
      postTokenBalances: [
        {
          mint: MINT_A,
          owner: ESCROW,
          uiTokenAmount: { amount: '1000000' },
        },
      ],
    },
    ESCROW
  )
  assert.equal(pickNftMintFromEscrowCredits(credits), MINT_A)
}

{
  // Ignore other owners.
  const credits = mintsCreditedToOwnerFromTokenBalances(
    {
      preTokenBalances: [],
      postTokenBalances: [
        {
          mint: MINT_A,
          owner: 'Other1111111111111111111111111111111111111',
          uiTokenAmount: { amount: '1' },
        },
      ],
    },
    ESCROW
  )
  assert.equal(credits.length, 0)
  assert.equal(pickNftMintFromEscrowCredits(credits), null)
}

// --- compiledInstructions collection (v0 / web3.js MessageV0) ---

{
  const ixs = collectDepositTxInstructions({
    transaction: {
      message: {
        compiledInstructions: [
          {
            programIdIndex: 2,
            accountKeyIndexes: [0, 1, 3],
            data: new Uint8Array([3, 1, 0, 0, 0, 0, 0, 0, 0]),
          },
        ],
      },
    },
    meta: {
      innerInstructions: [
        {
          instructions: [
            {
              programIdIndex: 4,
              accounts: [5, 6, 7],
              data: '3x',
            },
          ],
        },
      ],
    },
  })
  assert.equal(ixs.length, 2)
  assert.deepEqual(ixs[0]!.accounts, [0, 1, 3])
  assert.ok(ixs[0]!.data instanceof Uint8Array)
  assert.deepEqual(ixs[1]!.accounts, [5, 6, 7])
}

console.log('test-parse-deposit-tx: ok')
