/**
 * Scan recent blocks for a Solana Transaction V1 signature, then exercise
 * our payment/deposit parsers against it.
 *
 * Run: npx --yes tsx scripts/test-solana-v1-devnet-read.ts
 * Optional: SOLANA_V1_SIGNATURE=<sig> NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js'

import { getFullAccountKeysForTransaction } from '@/lib/verify-transaction'
import { collectDepositTxInstructions } from '@/lib/solana/parse-deposit-tx'
import { MAX_SUPPORTED_TRANSACTION_VERSION } from '@/lib/solana/transaction-version'

const FEATURE_GATE = 'txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL'
const ARTIFACT = '/opt/cursor/artifacts/solana-v1-devnet-parser-validation.log'

type Found = {
  cluster: string
  rpc: string
  signature: string
  slot: number
  version: unknown
  hasTransactionConfig: boolean
}

function rpcFor(cluster: 'devnet' | 'testnet'): string {
  if (cluster === 'devnet') {
    return (
      process.env.SOLANA_V1_DEVNET_RPC_URL?.trim() ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
      'https://api.devnet.solana.com'
    )
  }
  return process.env.SOLANA_V1_TESTNET_RPC_URL?.trim() || 'https://api.testnet.solana.com'
}

async function findV1InRecentBlocks(
  cluster: 'devnet' | 'testnet',
  slotsBack = 80
): Promise<Found | null> {
  const rpc = rpcFor(cluster)
  const conn = new Connection(rpc, 'confirmed')
  const slot = await conn.getSlot('confirmed')
  for (let s = slot; s > slot - slotsBack; s--) {
    try {
      const block = await conn.getBlock(s, {
        maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
        transactionDetails: 'full',
        rewards: false,
      })
      if (!block?.transactions?.length) continue
      for (const tw of block.transactions) {
        const version = (tw as { version?: unknown }).version
        const msg = tw.transaction.message as {
          transactionConfig?: unknown
          config?: unknown
        }
        const hasTransactionConfig = Boolean(msg.transactionConfig ?? msg.config)
        if (version === 1 || hasTransactionConfig) {
          const signature = tw.transaction.signatures?.[0]
          if (!signature) continue
          return {
            cluster,
            rpc,
            signature,
            slot: s,
            version,
            hasTransactionConfig,
          }
        }
      }
    } catch {
      // skipped/missing slot
    }
  }
  return null
}

async function resolveV1Signature(): Promise<Found> {
  const forced = process.env.SOLANA_V1_SIGNATURE?.trim()
  if (forced) {
    const cluster = (process.env.SOLANA_V1_CLUSTER?.trim() as 'devnet' | 'testnet') || 'devnet'
    return {
      cluster,
      rpc: rpcFor(cluster),
      signature: forced,
      slot: -1,
      version: 'forced',
      hasTransactionConfig: false,
    }
  }

  for (const cluster of ['devnet', 'testnet'] as const) {
    const found = await findV1InRecentBlocks(cluster)
    if (found) return found
  }
  throw new Error(
    'No v1 transaction found in recent blocks on public devnet/testnet. ' +
      'Re-run with SOLANA_V1_SIGNATURE=<sig> once you have one from Surfpool or transaction-v1-examples.'
  )
}

async function main() {
  const lines: string[] = []
  const log = (msg: string) => {
    lines.push(msg)
    console.log(msg)
  }

  assert.equal(MAX_SUPPORTED_TRANSACTION_VERSION, 1)

  const found = await resolveV1Signature()
  log(`cluster=${found.cluster} rpc=${found.rpc}`)
  log(`feature_gate=${FEATURE_GATE}`)
  log(`signature=${found.signature}`)
  log(`slot=${found.slot} scan_version=${String(found.version)} hasConfig=${found.hasTransactionConfig}`)

  const conn = new Connection(found.rpc, 'confirmed')

  // Confirm feature account exists (activated features keep an account).
  const featureInfo = await conn.getAccountInfo(new PublicKey(FEATURE_GATE))
  log(`feature_account_present=${featureInfo != null}`)

  // Prove ceiling 0 fails / 1 succeeds for a true v1 tx when possible.
  let gotWith0: unknown = null
  let errWith0: string | null = null
  try {
    gotWith0 = await conn.getTransaction(found.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
  } catch (e) {
    errWith0 = e instanceof Error ? e.message : String(e)
  }

  const tx = await conn.getTransaction(found.signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
  })
  assert.ok(tx, 'getTransaction with maxSupportedTransactionVersion=1 returned null')

  const version = (tx as { version?: unknown }).version
  const msg = tx.transaction.message as {
    transactionConfig?: unknown
    staticAccountKeys?: PublicKey[]
    accountKeys?: PublicKey[]
  }
  const hasConfig = Boolean(msg.transactionConfig)
  log(`fetched_version=${String(version)}`)
  log(`fetched_has_transactionConfig=${hasConfig}`)
  log(`getTransaction_version0_error=${errWith0 ?? 'none'}`)
  log(`getTransaction_version0_null=${gotWith0 == null && !errWith0}`)

  // Exercise deposit instruction collector + account-key expander used by verifies.
  const ixs = collectDepositTxInstructions(tx as never)
  assert.ok(Array.isArray(ixs), 'collectDepositTxInstructions should return an array')
  log(`deposit_ix_count=${ixs.length}`)

  if (tx.meta) {
    const keys = getFullAccountKeysForTransaction({
      transaction: { message: tx.transaction.message },
      meta: tx.meta,
    })
    assert.ok(keys.length > 0, 'getFullAccountKeysForTransaction should return keys')
    log(`full_account_keys=${keys.length}`)
  } else {
    log('full_account_keys=skipped(no meta)')
  }

  // Sanity: our ceiling still reads mundane system-program activity (legacy/v0).
  const recent = await conn.getSignaturesForAddress(SystemProgram.programId, { limit: 1 })
  if (recent[0]?.signature) {
    const legacyOrV0 = await conn.getTransaction(recent[0].signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
    })
    assert.ok(legacyOrV0, 'version ceiling 1 must still return legacy/v0 txs')
    log(`legacy_or_v0_read_ok=true version=${String((legacyOrV0 as { version?: unknown }).version)}`)
  }

  log('solana-v1-devnet-read: ok')
  try {
    writeFileSync(ARTIFACT, lines.join('\n') + '\n')
  } catch (err) {
    console.warn('artifact write skipped:', err instanceof Error ? err.message : err)
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.stack ?? e.message : String(e)
  console.error(msg)
  try {
    writeFileSync(ARTIFACT, msg + '\n')
  } catch {
    // ignore
  }
  process.exit(1)
})
