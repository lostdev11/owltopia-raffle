/**
 * Generate the Gen2 mint-proceeds DISTRIBUTION wallet keypair.
 *
 * This wallet is the single candy-guard `solPayment` destination (the enforced, bot-proof mint
 * price + freeze escrow land here); the /api/cron/gen2-treasury-split cron then sweeps it 50/50 to
 * the founder wallets. It briefly custodies live mint revenue between sweeps — treat the secret
 * like a hot wallet: store ONLY in .env.local + Vercel (never commit), and rotate after launch.
 *
 * Run:  npx --yes tsx scripts/gen2-gen-distribution-wallet.ts
 *
 * Then paste the printed secret into:
 *   .env.local                          GEN2_MINT_PROCEEDS_SECRET_KEY=<base58 secret>
 *   Vercel (Production) env             GEN2_MINT_PROCEEDS_SECRET_KEY=<base58 secret>
 *
 * Optionally pre-fund the printed PUBLIC address with ~0.05 SOL so the first sweep can pay fees.
 */
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

const kp = Keypair.generate()
const secretB58 = bs58.encode(kp.secretKey)

console.log('\n=== Gen2 distribution wallet (mint proceeds) ===')
console.log(`PUBLIC address          : ${kp.publicKey.toBase58()}`)
console.log(`SECRET (base58, KEEP SAFE): ${secretB58}`)
console.log('\nAdd to .env.local AND Vercel (Production):')
console.log(`  GEN2_MINT_PROCEEDS_SECRET_KEY=${secretB58}`)
console.log('\n⚠️  Do NOT commit this secret. Pre-fund the PUBLIC address with ~0.05 SOL for sweep fees.')
