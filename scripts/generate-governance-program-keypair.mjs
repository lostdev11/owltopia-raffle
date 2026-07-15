#!/usr/bin/env node
/**
 * Generates a NEW Solana keypair intended for Anchor program deploy signing.
 *
 * This does NOT change `declare_id!` or NEXT_PUBLIC_* — do that yourself if you rotate program id,
 * then `npm run copy:governance-keypair` and `anchor build` / deploy.
 *
 * Default output file (never committed — see governance-anchor/.gitignore):
 *   governance-anchor/keys/owltopia_governance-keypair.json
 *
 * Usage:
 *   node scripts/generate-governance-program-keypair.mjs
 *   node scripts/generate-governance-program-keypair.mjs --stdout-only
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Keypair } from '@solana/web3.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const defaultOut = path.join(root, 'governance-anchor', 'keys', 'owltopia_governance-keypair.json')

const stdoutOnly = process.argv.includes('--stdout-only')

const keypair = Keypair.generate()
const secretArr = [...keypair.secretKey]

if (!stdoutOnly) {
  const dir = path.dirname(defaultOut)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(defaultOut, JSON.stringify(secretArr), 'utf8')
}

console.log('Governance PROGRAM keypair (for Anchor deploy)')
console.log('')

console.log('Program id (= public key of this keypair):')
console.log(keypair.publicKey.toBase58())
console.log('')

if (!stdoutOnly) {
  console.log('Written locally (gitignored — do NOT commit):')
  console.log(defaultOut)
  console.log('')
}

console.log('IMPORTANT (read this):')
console.log('')
console.log('- Update declare_id!, Anchor.toml [programs.*], lib/governance/config.ts')
console.log('  DEFAULT_GOVERNANCE_PROGRAM_ID, and NEXT_PUBLIC_GOVERNANCE_PROGRAM_ID to the')
console.log('  program id printed above before building/deploying.')
console.log('- Keep this keypair out of git (governance-anchor/keys is gitignored).')
console.log('')
console.log('Then from repo root: npm run copy:governance-keypair && cd governance-anchor && anchor build')
