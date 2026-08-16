#!/usr/bin/env node
/**
 * Option A — Gembird-only, one-time: authorize the server hot key as an
 * additional UpdateDelegate on the Owltopia Coins MPL Core collection.
 *
 * After this tx confirms, the hot key (COIN_ART_UPGRADE_AUTHORITY_*) can
 * repoint coin URIs without ever seeing Gembird's root update-authority secret.
 *
 * Env (Gembird runs this locally — never paste his secret into Vercel/chat):
 *   COIN_COLLECTION_UPDATE_AUTHORITY_SECRET_KEY  — secret for 7PRb9…7ygS (JSON or base58)
 *   COIN_ART_UPGRADE_AUTHORITY_WALLET             — public key from generate-coin-art-upgrade-authority-keypair.mjs
 *   NEXT_PUBLIC_SOLANA_RPC_URL / SOLANA_RPC_URL   — RPC (mainnet)
 * Optional:
 *   OWLTOPIA_COIN_COLLECTION_ADDRESS             — default EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB
 *
 * Run:
 *   node --env-file=.env.local scripts/authorize-coin-art-upgrade-delegate.mjs --dry-run
 *   node --env-file=.env.local scripts/authorize-coin-art-upgrade-delegate.mjs
 */

import bs58 from 'bs58'
import { Keypair, PublicKey } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from '@metaplex-foundation/umi'
import {
  fetchCollection,
  mplCore,
  updateCollectionPlugin,
} from '@metaplex-foundation/mpl-core'

const DEFAULT_COLLECTION = 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB'
const EXPECTED_UPDATE_AUTHORITY = '7PRb92msjUQTPmXnn79Lyt3UetUvmZFuwya4ZaVZ7ygS'
const DRY_RUN = process.argv.includes('--dry-run')

function parseSecretKey(raw) {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    return null
  }
}

function resolveRpc() {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    (process.env.HELIUS_API_KEY?.trim()
      ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY.trim())}`
      : 'https://api.mainnet-beta.solana.com')
  )
}

function signatureToString(result) {
  const sig = result?.signature ?? result
  if (sig instanceof Uint8Array) return bs58.encode(sig)
  if (Array.isArray(sig)) return bs58.encode(Uint8Array.from(sig))
  return String(sig)
}

async function main() {
  const collectionAddress =
    process.env.OWLTOPIA_COIN_COLLECTION_ADDRESS?.trim() ||
    process.env.NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS?.trim() ||
    DEFAULT_COLLECTION
  const hotWallet = process.env.COIN_ART_UPGRADE_AUTHORITY_WALLET?.trim()
  if (!hotWallet) {
    throw new Error(
      'COIN_ART_UPGRADE_AUTHORITY_WALLET is required (public key from generate-coin-art-upgrade-authority-keypair.mjs).'
    )
  }
  try {
    new PublicKey(hotWallet)
  } catch {
    throw new Error(`Invalid COIN_ART_UPGRADE_AUTHORITY_WALLET: ${hotWallet}`)
  }

  const authority = parseSecretKey(process.env.COIN_COLLECTION_UPDATE_AUTHORITY_SECRET_KEY)
  if (!authority) {
    throw new Error(
      'COIN_COLLECTION_UPDATE_AUTHORITY_SECRET_KEY is required (Gembird collection update authority — JSON byte array or base58).'
    )
  }

  const authorityB58 = authority.publicKey.toBase58()
  console.log(`Collection:          ${collectionAddress}`)
  console.log(`Signing as:          ${authorityB58}`)
  console.log(`Hot key to authorize:${hotWallet}`)
  console.log(`Dry run:             ${DRY_RUN}`)

  if (authorityB58 !== EXPECTED_UPDATE_AUTHORITY) {
    console.warn(
      `\n⚠ Signer ${authorityB58} does not match the on-chain collection update authority ${EXPECTED_UPDATE_AUTHORITY}.\n` +
        '  Continuing anyway — if this key is not the update authority (or an existing UpdateDelegate), the tx will fail.\n'
    )
  }

  const umi = createUmi(resolveRpc()).use(mplCore())
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(authority.secretKey)
  const signer = createSignerFromKeypair(umi, umiKeypair)
  umi.use(signerIdentity(signer))

  const collection = await fetchCollection(umi, publicKey(collectionAddress))
  const onChainAuthority = String(collection.updateAuthority)
  console.log(`On-chain update auth:${onChainAuthority}`)

  if (onChainAuthority !== authorityB58) {
    throw new Error(
      `Signer ${authorityB58} is not the collection update authority (${onChainAuthority}). Gembird must sign with the root key.`
    )
  }

  const existing = (collection.updateDelegate?.additionalDelegates ?? []).map(String)
  console.log(`Current additionalDelegates (${existing.length}):`)
  for (const d of existing) console.log(`  - ${d}`)

  if (existing.includes(hotWallet)) {
    console.log('\nAlready authorized — nothing to do.')
    return
  }

  const nextDelegates = [...existing, hotWallet]
  console.log(`\nWill set additionalDelegates to ${nextDelegates.length} key(s):`)
  for (const d of nextDelegates) console.log(`  - ${d}`)

  if (DRY_RUN) {
    console.log('\n[dry-run] stopping before sending the transaction.')
    return
  }

  const result = await updateCollectionPlugin(umi, {
    collection: collection.publicKey,
    plugin: {
      type: 'UpdateDelegate',
      additionalDelegates: nextDelegates.map((d) => publicKey(d)),
    },
  }).sendAndConfirm(umi)

  const signature = signatureToString(result)
  console.log(`\nAuthorized. Signature: ${signature}`)
  console.log('Verify with:')
  console.log(
    `  COIN_ART_UPGRADE_AUTHORITY_WALLET=${hotWallet} node scripts/verify-coin-art-upgrade-delegate.mjs`
  )
}

main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
