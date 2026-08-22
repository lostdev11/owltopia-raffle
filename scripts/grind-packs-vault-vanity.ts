/**
 * Multi-worker grind for Owl Packs vault vanity address.
 *
 * Solana base58 excludes 0/O/I/l — literal "Owl" is impossible.
 * Default prefix `owL` reads as Owl.
 *
 *   npm run packs:grind-vault
 *   npm run packs:grind-vault -- --prefix owL --workers 8
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { cpus } from 'node:os'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { fileURLToPath } from 'node:url'

const DEFAULT_PREFIX = 'owL'
const BASE58_FORBIDDEN = /[0OIl]/

function parseArgs(argv: string[]) {
  let prefix = DEFAULT_PREFIX
  let caseSensitive = true
  let outDir = join(process.cwd(), '.local')
  let workers = Math.max(2, Math.min(cpus().length || 4, 12))
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--prefix' && argv[i + 1]) prefix = argv[++i]!
    else if (a === '--case-insensitive' || a === '-i') caseSensitive = false
    else if (a === '--case-sensitive') caseSensitive = true
    else if (a === '--out' && argv[i + 1]) outDir = argv[++i]!
    else if (a === '--workers' && argv[i + 1]) workers = Math.max(1, Number(argv[++i]))
    else if (a === '--help' || a === '-h') {
      console.log(`Grind packs vault vanity wallet

  --prefix <str>   Default: ${DEFAULT_PREFIX} (reads as Owl; O/l not in base58)
  --workers <n>    Parallel workers (default: CPU count)
  --case-insensitive / -i
  --out <dir>      Default: .local`)
      process.exit(0)
    }
  }
  return { prefix, caseSensitive, outDir, workers }
}

function assertGrindablePrefix(prefix: string) {
  if (!prefix) throw new Error('Prefix required')
  if (BASE58_FORBIDDEN.test(prefix)) {
    throw new Error(
      `Prefix "${prefix}" has invalid base58 chars (0, O, I, l). Use "owL" or "ow1".`
    )
  }
}

function matches(address: string, prefix: string, caseSensitive: boolean) {
  return caseSensitive
    ? address.startsWith(prefix)
    : address.toLowerCase().startsWith(prefix.toLowerCase())
}

if (!isMainThread) {
  const { prefix, caseSensitive } = workerData as {
    prefix: string
    caseSensitive: boolean
  }
  let attempts = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const kp = Keypair.generate()
    attempts++
    const address = kp.publicKey.toBase58()
    if (matches(address, prefix, caseSensitive)) {
      parentPort!.postMessage({
        type: 'found',
        address,
        secretKey: Array.from(kp.secretKey),
        attempts,
      })
      break
    }
    if (attempts % 5000 === 0) {
      parentPort!.postMessage({ type: 'progress', attempts: 5000 })
      attempts = 0
    }
  }
} else {
  async function main() {
    const { prefix, caseSensitive, outDir, workers } = parseArgs(process.argv.slice(2))
    assertGrindablePrefix(prefix)

    console.log(
      `Grinding "${prefix}" with ${workers} workers (${caseSensitive ? 'case-sensitive' : 'case-insensitive'})…`
    )
    console.log('Note: Solana addresses cannot contain O or l — owL ≈ Owl.\n')

    const started = Date.now()
    let totalAttempts = 0
    let lastLog = started
    let done = false

    const selfPath = fileURLToPath(import.meta.url)
    const pool: Worker[] = []

    const stopAll = () => {
      for (const w of pool) {
        void w.terminate()
      }
    }

    await new Promise<void>((resolve, reject) => {
      for (let i = 0; i < workers; i++) {
        const w = new Worker(selfPath, {
          workerData: { prefix, caseSensitive },
          execArgv: process.execArgv,
        })
        pool.push(w)
        w.on('message', (msg: {
          type: string
          address?: string
          secretKey?: number[]
          attempts?: number
        }) => {
          if (done) return
          if (msg.type === 'progress') {
            totalAttempts += msg.attempts || 0
            const now = Date.now()
            if (now - lastLog >= 3000) {
              const rate = totalAttempts / ((now - started) / 1000)
              console.log(
                `… ${totalAttempts.toLocaleString()} tried (~${Math.round(rate).toLocaleString()}/s)`
              )
              lastLog = now
            }
            return
          }
          if (msg.type === 'found' && msg.address && msg.secretKey) {
            done = true
            totalAttempts += msg.attempts || 0
            const elapsedSec = ((Date.now() - started) / 1000).toFixed(1)
            const address = msg.address
            const secretArray = msg.secretKey
            const secretB58 = bs58.encode(Uint8Array.from(secretArray))

            mkdirSync(outDir, { recursive: true })
            const jsonPath = join(outDir, 'packs-vault-keypair.json')
            const metaPath = join(outDir, 'packs-vault-keypair.meta.json')
            const txtPath = join(outDir, 'packs-vault-keypair.txt')
            if (existsSync(jsonPath) || existsSync(metaPath) || existsSync(txtPath)) {
              console.warn(`Warning: overwriting existing files in ${outDir}`)
            }

            // Standard Solana CLI keypair: single-line JSON array of 64 bytes.
            writeFileSync(jsonPath, JSON.stringify(secretArray), { mode: 0o600 })
            writeFileSync(
              metaPath,
              JSON.stringify(
                {
                  publicKey: address,
                  secretKeyBase58: secretB58,
                  prefix,
                  attempts: totalAttempts,
                  generatedAt: new Date().toISOString(),
                },
                null,
                2
              ),
              { mode: 0o600 }
            )
            writeFileSync(
              txtPath,
              [
                `PACKS VAULT VANITY KEYPAIR — KEEP SECRET`,
                `publicKey=${address}`,
                `PACKS_VAULT_SECRET_KEY=${JSON.stringify(secretArray)}`,
                `NEXT_PUBLIC_PACKS_VAULT_WALLET=${address}`,
                `attempts=${totalAttempts}`,
                `elapsedSec=${elapsedSec}`,
                '',
              ].join('\n'),
              { mode: 0o600 }
            )

            console.log(`\nFound after ${totalAttempts.toLocaleString()} attempts in ${elapsedSec}s`)
            console.log(`Public key:  ${address}`)
            console.log(`Wrote:       ${jsonPath} (standard [64] keypair)`)
            console.log(`Wrote:       ${metaPath}`)
            console.log(`Wrote:       ${txtPath}`)
            console.log(`\nSet in Vercel / .env.local (do not paste secret in chat):`)
            console.log(`  npm run packs:install-vault-env`)
            console.log(`  Public address: ${address}`)
            console.log(`\nAll pack purchase SOL goes to this wallet; prizes pay out from it.`)
            console.log(`Fund with SOL + $OWL + NFTs, then unpause in Admin → Packs.`)

            stopAll()
            resolve()
          }
        })
        w.on('error', (err) => {
          if (!done) {
            done = true
            stopAll()
            reject(err)
          }
        })
      }
    })
  }

  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
