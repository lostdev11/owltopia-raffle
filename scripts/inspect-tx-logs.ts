/**
 * Read-only: print a transaction's program logs (to see which candy guard triggered a bot tax).
 *   npx --yes tsx --env-file=.env.local scripts/inspect-tx-logs.ts <signature>
 */
import { Connection } from '@solana/web3.js'

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

async function main() {
  const sig = process.argv[2]?.trim()
  if (!sig) throw new Error('Usage: inspect-tx-logs.ts <signature>')
  const conn = new Connection(RPC, 'confirmed')
  const tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
  if (!tx?.meta) throw new Error('tx/meta not found')
  console.log(`tx ${sig}  err=${JSON.stringify(tx.meta.err)}`)
  console.log('=== logs ===')
  for (const l of tx.meta.logMessages ?? []) console.log(l)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('failed:', e)
    process.exit(1)
  })
