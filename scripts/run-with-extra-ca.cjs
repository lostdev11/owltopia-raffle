/**
 * Set NODE_EXTRA_CA_CERTS from .env.local, then spawn Next.js.
 * Avoids `node -r` (blocked when NODE_OPTIONS forbids -r).
 *
 * Optional local-only: ALLOW_INSECURE_TLS=1 in .env.local sets
 * NODE_TLS_REJECT_UNAUTHORIZED=0 (needed when Norton HTTPS scanning
 * presents a MITM leaf that does not verify against the installed Norton root).
 *
 * Usage: node scripts/run-with-extra-ca.cjs dev --webpack
 */
require('./load-node-extra-ca.cjs')

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

function readEnvLocalFlag(name) {
  try {
    const envPath = path.join(process.cwd(), '.env.local')
    if (!fs.existsSync(envPath)) return null
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const m = trimmed.match(new RegExp(`^${name}\\s*=\\s*(.*)$`))
      if (!m) continue
      let v = (m[1] || '').trim()
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1)
      }
      return v
    }
  } catch {
    return null
  }
  return null
}

const allowInsecure =
  process.env.ALLOW_INSECURE_TLS === '1' ||
  process.env.ALLOW_INSECURE_TLS === 'true' ||
  readEnvLocalFlag('ALLOW_INSECURE_TLS') === '1' ||
  readEnvLocalFlag('ALLOW_INSECURE_TLS') === 'true'

if (allowInsecure) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  console.warn(
    '[run-with-extra-ca] ALLOW_INSECURE_TLS=1 — TLS certificate verification disabled for this Node process (local Norton workaround).'
  )
}

const nextBin = require.resolve('next/dist/bin/next')
const args = process.argv.slice(2)

const child = spawn(process.execPath, [nextBin, ...args], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
