#!/usr/bin/env node
/**
 * Mint one or more devnet NFTs (SPL token, 0 decimals, supply 1 each) into a wallet.
 * Use this to get test NFTs for escrow testing.
 *
 * Prerequisites:
 * - Wallet has devnet SOL (https://faucet.solana.com, set to Devnet).
 * - Keypair file: copy your Phantom devnet wallet secret key as JSON array
 *   (Phantom: Settings → Security & Privacy → Export Private Key → copy the [1,2,...,64] array).
 *   Save to: scripts/phantom-devnet-keypair.json (only the array, e.g. [1,2,...,64])
 *
 * Usage:
 *   node scripts/mint-devnet-nft.mjs
 *   (mints 1 NFT using scripts/phantom-devnet-keypair.json)
 *
 *   node scripts/mint-devnet-nft.mjs path/to/keypair.json
 *   (mints 1 NFT using that keypair)
 *
 *   node scripts/mint-devnet-nft.mjs path/to/keypair.json 5
 *   (mints 5 NFTs)
 *
 *   npm run mint:devnet-nft -- 3
 *   (mints 3 NFTs with default keypair)
 *
 * Env: SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL = devnet RPC (default: https://api.devnet.solana.com)
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_KEYPAIR_PATH = path.join(__dirname, 'phantom-devnet-keypair.json')
const RPC =
  process.env.SOLANA_RPC_URL?.trim() ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
  'https://api.devnet.solana.com'

async function loadKeypair(filePath) {
  const raw = readFileSync(filePath, 'utf8').trim()
  // Format 1: JSON array of 64 numbers [1,2,...,64]
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr) && arr.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(arr))
    }
  } catch (_) {}
  // Format 2: base58 string (e.g. Phantom export on some versions)
  try {
    const bs58 = (await import('bs58')).default
    const bytes = bs58.decode(raw)
    if (bytes.length >= 64) {
      return Keypair.fromSecretKey(bytes)
    }
  } catch (_) {}
  throw new Error(
    `Invalid keypair file. Use a JSON array of 64 numbers [1,2,...,64] or a base58 private key. Path: ${filePath}`
  )
}

function parseArgs() {
  const a2 = process.argv[2]
  const a3 = process.argv[3]
  const num = (s) => { const n = parseInt(s, 10); return Number.isInteger(n) && n >= 1 ? n : null }
  let keypairPath = DEFAULT_KEYPAIR_PATH
  let count = 1
  if (a2 !== undefined && a2 !== '') {
    if (num(a2) !== null) {
      count = num(a2)
    } else {
      keypairPath = a2
      if (a3 !== undefined && num(a3) !== null) count = num(a3)
    }
  }
  return { keypairPath, count }
}

async function main() {
  const { keypairPath, count } = parseArgs()
  if (!existsSync(keypairPath)) {
    console.error(`
No keypair file found at: ${keypairPath}

To mint a devnet NFT into your Phantom wallet:

1. In Phantom, switch to Devnet (Settings → Developer settings → Change Network → Devnet).

2. Export your private key:
   - Settings → Security & Privacy → Export Private Key
   - Copy the entire key (it looks like [1,2,3,...,64])

3. Create a file with ONLY that key (no extra text):
   - Create: scripts/phantom-devnet-keypair.json
   - Paste the copied array as the only content, e.g.: [1,2,3,...,64]
   - Save the file.

4. Get devnet SOL for that wallet:
   - Go to https://faucet.solana.com
   - Select Devnet, paste your wallet address, request SOL.

5. Run this script again:
   node scripts/mint-devnet-nft.mjs
`)
    process.exit(1)
  }

  const payer = await loadKeypair(keypairPath)
  const connection = new Connection(RPC, 'confirmed')

  console.log('Wallet address:', payer.publicKey.toBase58())
  console.log('RPC:', RPC)
  console.log(`Minting ${count} NFT(s) to your wallet...`)

  const mintAddresses = []
  for (let i = 0; i < count; i++) {
    const mintAddress = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      0, // decimals = 0 makes it an NFT
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    )
    mintAddresses.push(mintAddress)
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mintAddress,
      payer.publicKey,
      undefined,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    )
    await mintTo(
      connection,
      payer,
      mintAddress,
      ata.address,
      payer,
      1n,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    )
    console.log(`  ${i + 1}/${count} minted: ${mintAddress.toBase58()}`)
  }

  console.log(`\nMinted ${count} NFT(s) to your wallet.`)
  if (mintAddresses.length === 1) {
    console.log(`
Done. Your devnet NFT mint address is:
  ${mintAddresses[0].toBase58()}
`)
  } else {
    console.log(`
Done. Your devnet NFT mint addresses:
${mintAddresses.map((m) => `  ${m.toBase58()}`).join('\n')}
`)
  }
  console.log(`
Next steps:
  1. Open your app (npm run dev), go to Create Raffle.
  2. Connect Phantom (make sure it's on Devnet).
  3. Click "Load NFTs & tokens from wallet" — your NFT(s) should appear.
  4. Select one, fill the raffle form, create the raffle.
  5. On the raffle detail page: "Transfer NFT to escrow" → confirm in the dialog → then "Verify deposit".
`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
