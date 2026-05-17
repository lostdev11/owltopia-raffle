/**
 * Copies the governance program keypair JSON to governance-anchor/target/deploy/
 * for `anchor build` / `anchor deploy`.
 *
 * Path source (first match wins):
 *   1. GOVERNANCE_PROGRAM_KEYPAIR_PATH (absolute or relative to repo root)
 *   2. governance-anchor/keys/owltopia_governance-keypair.json
 *
 * Loads `.env.local` from repo root if present (does not override existing env).
 *
 * Usage: npm run copy:governance-keypair
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function loadDotEnvLocal() {
  const p = path.join(root, '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadDotEnvLocal()

const fromEnv = process.env.GOVERNANCE_PROGRAM_KEYPAIR_PATH?.trim()

/** Env must be a path to a .json file — not the raw Solana keypair array pasted as the value. */
function looksLikeKeypairJsonNotPath(s) {
  const t = s.trim()
  if (!t.startsWith('[')) return false
  return /^\[\s*\d/.test(t)
}

if (fromEnv && looksLikeKeypairJsonNotPath(fromEnv)) {
  console.error(
    '[copy-governance-program-keypair] GOVERNANCE_PROGRAM_KEYPAIR_PATH looks like keypair JSON, not a file path.\n' +
      '  Put the array in a file, e.g. governance-anchor/keys/owltopia_governance-keypair.json\n' +
      '  Then either remove GOVERNANCE_PROGRAM_KEYPAIR_PATH (default uses that file) or set it to that path.'
  )
  process.exit(1)
}

const src = fromEnv
  ? path.isAbsolute(fromEnv)
    ? fromEnv
    : path.join(root, fromEnv)
  : path.join(root, 'governance-anchor', 'keys', 'owltopia_governance-keypair.json')

const destDir = path.join(root, 'governance-anchor', 'target', 'deploy')
const dest = path.join(destDir, 'owltopia_governance-keypair.json')

if (!fs.existsSync(src)) {
  console.error(`[copy-governance-program-keypair] File not found:\n  ${src}`)
  console.error(
    'GOVERNANCE_PROGRAM_KEYPAIR_PATH must be a path to your keypair .json file (not the secret pasted inline).'
  )
  console.error('Default file: governance-anchor/keys/owltopia_governance-keypair.json')
  process.exit(1)
}

fs.mkdirSync(destDir, { recursive: true })
fs.copyFileSync(src, dest)
console.log(`[copy-governance-program-keypair] Copied\n  from: ${src}\n  to:   ${dest}`)
