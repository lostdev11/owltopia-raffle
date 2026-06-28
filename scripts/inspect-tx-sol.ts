/**
 * Read-only: print per-account SOL balance deltas for a transaction, so we can see exactly
 * who paid what (mint price -> distribution wallet, platform fee -> treasury, etc.).
 *   npx --yes tsx --env-file=.env.local scripts/inspect-tx-sol.ts <signature>
 */
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js'

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const DIST = '3L2XNS7iNCFDmsMfNV3JLgCjkEaPWcCxPBXfDwF7uoTS' // candy-guard solPayment destination

async function main() {
  const sig = process.argv[2]?.trim()
  if (!sig) throw new Error('Usage: inspect-tx-sol.ts <signature>')
  const conn = new Connection(RPC, 'confirmed')
  const tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
  if (!tx) throw new Error('tx not found')

  const meta = tx.meta
  if (!meta) throw new Error('no meta')
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58())

  console.log(`tx ${sig}`)
  console.log(`err=${JSON.stringify(meta.err)} fee=${meta.fee} lamports (${(meta.fee / LAMPORTS_PER_SOL).toFixed(6)} SOL)`) 
  console.log('')
  console.log('=== SOL balance deltas ===')
  for (let i = 0; i < keys.length; i++) {
    const pre = meta.preBalances[i] ?? 0
    const post = meta.postBalances[i] ?? 0
    const delta = post - pre
    if (delta === 0) continue
    const tag = keys[i] === DIST ? '  <-- solPayment destination (distribution wallet)' : ''
    console.log(`  ${keys[i]}  ${delta > 0 ? '+' : ''}${(delta / LAMPORTS_PER_SOL).toFixed(6)} SOL${tag}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('failed:', e)
    process.exit(1)
  })
