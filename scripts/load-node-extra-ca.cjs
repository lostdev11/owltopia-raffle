/**
 * Ensure NODE_EXTRA_CA_CERTS is set before Next/Node opens TLS to Supabase.
 * Next.js loads .env.local for `process.env` in app code, but OpenSSL only
 * reads NODE_EXTRA_CA_CERTS from the real process environment at startup —
 * so a value only in .env.local is ignored for fetch() TLS.
 *
 * Usage: node -r ./scripts/load-node-extra-ca.cjs …
 */
const fs = require('fs')
const path = require('path')

function stripQuotes(v) {
  const t = v.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1)
  }
  return t
}

function readEnvLocalExtraCa() {
  try {
    const envPath = path.join(process.cwd(), '.env.local')
    if (!fs.existsSync(envPath)) return null
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const m = trimmed.match(/^NODE_EXTRA_CA_CERTS\s*=\s*(.*)$/)
      if (m) return stripQuotes(m[1] || '')
    }
  } catch {
    return null
  }
  return null
}

if (!process.env.NODE_EXTRA_CA_CERTS || !String(process.env.NODE_EXTRA_CA_CERTS).trim()) {
  const fromFile = readEnvLocalExtraCa()
  if (fromFile) process.env.NODE_EXTRA_CA_CERTS = fromFile
}

const ca = process.env.NODE_EXTRA_CA_CERTS
if (ca && !fs.existsSync(ca)) {
  console.warn(
    `[load-node-extra-ca] NODE_EXTRA_CA_CERTS file not found: ${ca}\n` +
      '  Supabase / HTTPS may fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE (common with Norton HTTPS scanning).'
  )
}
