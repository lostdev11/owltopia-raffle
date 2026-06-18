/**
 * Generate a DEVNET-ONLY keypair for the Core freeze spike / devnet testing.
 * Writes scripts/phantom-devnet-keypair.json (gitignored) as a JSON [1..64] array,
 * and prints the address to fund + a base58 secret key you can import into Phantom (Devnet).
 *
 * Run: node scripts/generate-spike-devnet-keypair.mjs
 *
 * ⚠️  DEVNET ONLY. Never send real funds here. Never reuse on mainnet. Never commit the file.
 */
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'phantom-devnet-keypair.json')

if (existsSync(OUT) && process.argv[2] !== '--force') {
  console.error(`Refusing to overwrite existing ${OUT}. Re-run with --force to replace it.`)
  process.exit(1)
}

const kp = Keypair.generate()
writeFileSync(OUT, JSON.stringify(Array.from(kp.secretKey)))

console.log('✅ Wrote', OUT)
console.log('\nAddress to FUND (devnet):')
console.log(' ', kp.publicKey.toBase58())
console.log('\nImport into Phantom → Add/Connect Wallet → Import Private Key (set network to Devnet):')
console.log(' ', bs58.encode(kp.secretKey))
console.log('\nFund it at https://faucet.solana.com (select Devnet), then run:')
console.log('  node scripts/spike-core-freeze-devnet.mjs')
console.log('\n⚠️  DEVNET ONLY — do not send real SOL or NFTs to this address.')
