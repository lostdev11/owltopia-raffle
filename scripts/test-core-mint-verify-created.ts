/**
 * Unit checks for Core mint verify helper (bot-tax vs real createAccount).
 *
 * Run: npx --yes tsx scripts/test-core-mint-verify-created.ts
 */
import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { PublicKey, SystemProgram } from '@solana/web3.js'

import { coreTxCreatedRequiredAssets } from '@/lib/owl-center/verify-gen2-mint-tx'

const CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
const WALLET = 'DNoggcEL6DGdQAjaqxK7v5ktZchvXKtZdkaN6FPx2Fj1'
const ASSET = 'BocivH3hnJLnsfpfrabcHb8Focdv4gMSZcsiN1sBLZ11'
const PLANNED_ONLY = '3SVrQLKD1ypQpjuUY9wYa14KXNAX2EbwFkHq7EQvueEr'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  - ${name}`)
  else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

function mintedTx(): ParsedTransactionWithMeta {
  const walletPk = new PublicKey(WALLET)
  const assetPk = new PublicKey(ASSET)
  return {
    slot: 1,
    transaction: {
      signatures: ['sig'],
      message: {
        accountKeys: [
          { pubkey: walletPk, signer: true, writable: true, source: 'transaction' },
          { pubkey: assetPk, signer: true, writable: true, source: 'transaction' },
        ],
        instructions: [],
        recentBlockhash: '11111111111111111111111111111111',
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1, 0],
      postBalances: [1, 1],
      logMessages: ['Program log: Instruction: MintAsset'],
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

function botTaxTx(): ParsedTransactionWithMeta {
  const walletPk = new PublicKey(WALLET)
  const plannedPk = new PublicKey(PLANNED_ONLY)
  return {
    slot: 1,
    transaction: {
      signatures: ['bot'],
      message: {
        accountKeys: [
          { pubkey: walletPk, signer: true, writable: true, source: 'transaction' },
          { pubkey: plannedPk, signer: true, writable: true, source: 'transaction' },
        ],
        instructions: [],
        recentBlockhash: '11111111111111111111111111111111',
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1, 0],
      postBalances: [1, 0],
      logMessages: ['Program log: Instruction: MintV1', 'AllowedMintLimitReached'],
      innerInstructions: [],
    },
  } as unknown as ParsedTransactionWithMeta
}

console.log('Core mint verify created assets:')

check('real mint passes with matching asset', coreTxCreatedRequiredAssets(mintedTx(), [ASSET], 1))
check('real mint passes without asset list', coreTxCreatedRequiredAssets(mintedTx(), undefined, 1))
check('bot-tax fails even when planned asset listed', !coreTxCreatedRequiredAssets(botTaxTx(), [PLANNED_ONLY], 1))
check('bot-tax fails with empty asset list', !coreTxCreatedRequiredAssets(botTaxTx(), [], 1))
check('wrong planned asset fails on real mint', !coreTxCreatedRequiredAssets(mintedTx(), [PLANNED_ONLY], 1))

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll core mint verify checks passed.')
