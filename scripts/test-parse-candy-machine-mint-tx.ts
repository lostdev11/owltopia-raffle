/**
 * Unit checks for Core + Token Metadata Candy Machine mint tx parsing.
 *
 * Run: npx --yes tsx scripts/test-parse-candy-machine-mint-tx.ts
 */
import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { PublicKey, SystemProgram } from '@solana/web3.js'

import {
  collectCoreAssetsCreatedInTx,
  parseCandyMachineMintFromTransaction,
} from '@/lib/owl-center/parse-candy-machine-mint-tx'

const CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
const CM = '8sdRTMcE7DrAfuzrdLz5K2YkGQe5UT1QhpnkXUmiHkiy'
const WALLET = 'DNoggcEL6DGdQAjaqxK7v5ktZchvXKtZdkaN6FPx2Fj1'
const ASSET = 'BocivH3hnJLnsfpfrabcHb8Focdv4gMSZcsiN1sBLZ11'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  - ${name}`)
  else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

function coreMintTx(): ParsedTransactionWithMeta {
  const walletPk = new PublicKey(WALLET)
  const cmPk = new PublicKey(CM)
  return {
    slot: 1,
    transaction: {
      signatures: ['sig'],
      message: {
        accountKeys: [
          { pubkey: walletPk, signer: true, writable: true, source: 'transaction' },
          { pubkey: cmPk, signer: false, writable: true, source: 'transaction' },
        ],
        instructions: [],
        recentBlockhash: '11111111111111111111111111111111',
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1, 1],
      postBalances: [1, 1],
      logMessages: ['Program log: Instruction: MintV1'],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              programId: SystemProgram.programId,
              program: 'system',
              parsed: {
                type: 'createAccount',
                info: {
                  source: WALLET,
                  newAccount: ASSET,
                  owner: CORE_PROGRAM,
                  lamports: 2000000,
                  space: 200,
                },
              },
            },
          ],
        },
      ],
    },
  } as unknown as ParsedTransactionWithMeta
}

function tmMintTx(): ParsedTransactionWithMeta {
  const walletPk = new PublicKey(WALLET)
  const cmPk = new PublicKey(CM)
  const nftMint = 'So11111111111111111111111111111111111111112'
  return {
    slot: 1,
    transaction: {
      signatures: ['sig'],
      message: {
        accountKeys: [
          { pubkey: walletPk, signer: true, writable: true, source: 'transaction' },
          { pubkey: cmPk, signer: false, writable: true, source: 'transaction' },
        ],
        instructions: [],
        recentBlockhash: '11111111111111111111111111111111',
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1, 1],
      postBalances: [1, 1],
      logMessages: ['Program log: Instruction: MintV2'],
      preTokenBalances: [],
      postTokenBalances: [
        {
          accountIndex: 2,
          mint: nftMint,
          owner: WALLET,
          uiTokenAmount: { amount: '1', decimals: 0, uiAmount: 1, uiAmountString: '1' },
        },
      ],
    },
  } as unknown as ParsedTransactionWithMeta
}

console.log('Candy Machine mint tx parse:')

{
  const tx = coreMintTx()
  check('collects Core createAccount asset', collectCoreAssetsCreatedInTx(tx)[0] === ASSET)
  const mint = parseCandyMachineMintFromTransaction(tx, CM)
  check('Core MintV1 wallet', mint?.wallet === WALLET)
  check('Core MintV1 asset', mint?.mintedNftMints[0] === ASSET)
  check('Core MintV1 qty 1', mint?.quantity === 1)
}

{
  const tx = tmMintTx()
  const mint = parseCandyMachineMintFromTransaction(tx, CM)
  check('TM MintV2 wallet', mint?.wallet === WALLET)
  check('TM MintV2 mint', mint?.mintedNftMints[0] === 'So11111111111111111111111111111111111111112')
}

{
  const tx = coreMintTx()
  tx.meta = { ...tx.meta!, err: { InstructionError: [0, 'Custom'] } }
  check('failed Core tx is ignored', parseCandyMachineMintFromTransaction(tx, CM) === null)
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll candy-machine mint parse checks passed.')
