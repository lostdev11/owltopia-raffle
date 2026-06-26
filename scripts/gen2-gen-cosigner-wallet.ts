/**
 * Generate the Gen2 mint CO-SIGNER keypair.
 *
 * This keypair gates the FREE phases (gen1 airdrop + presale). Its public key goes into a
 * `thirdPartySigner` candy-guard on the `gen1` and `pre` groups, so no free mint can land unless
 * the server co-signs it (`/api/owl-center/gen2/cosign-mint`), which it only does after checking
 * the wallet's remaining credits. This closes the website-bypass over-mint edge case that a flat
 * on-chain mintLimit cannot (presale amounts vary per wallet).
 *
 * It holds NO funds and has NO on-chain authority — use a DEDICATED key (NOT the guard authority
 * or distribution wallet) so a leak cannot touch guards or treasury. A leak only reopens the
 * bypass, so still keep it server-only and rotate after launch.
 *
 * Run:  npx --yes tsx scripts/gen2-gen-cosigner-wallet.ts
 *
 * Then paste the printed secret into:
 *   .env.local                  GEN2_MINT_COSIGNER_SECRET_KEY=<base58 secret>
 *   Vercel (Production) env      GEN2_MINT_COSIGNER_SECRET_KEY=<base58 secret>
 *
 * Then write the pubkey into the guard:  npm run … scripts/gen2-cm-setup.ts guards --confirm
 */
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

const kp = Keypair.generate()
const secretB58 = bs58.encode(kp.secretKey)

console.log('\n=== Gen2 mint co-signer (free-phase gate) ===')
console.log(`PUBLIC key                : ${kp.publicKey.toBase58()}`)
console.log(`SECRET (base58, KEEP SAFE): ${secretB58}`)
console.log('\nAdd to .env.local AND Vercel (Production):')
console.log(`  GEN2_MINT_COSIGNER_SECRET_KEY=${secretB58}`)
console.log('\nThen run the guard setup so the on-chain thirdPartySigner uses this PUBLIC key:')
console.log('  npx --yes tsx --env-file=.env.local scripts/gen2-cm-setup.ts guards          (dry-run)')
console.log('  npx --yes tsx --env-file=.env.local scripts/gen2-cm-setup.ts guards --confirm')
console.log('\n⚠️  Do NOT commit this secret. It needs no SOL (server only co-signs, never pays).')
