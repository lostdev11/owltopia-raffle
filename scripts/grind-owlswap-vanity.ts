/**
 * Multi-worker grind for OwlSwap vanity addresses (ops wallet + escrow).
 *
 * Solana base58 excludes 0/O/I/l — literal "Owl" is impossible.
 * Default prefix `owL` reads as Owl.
 *
 *   npm run owlswap:grind-wallets
 *   npm run owlswap:grind-wallets -- --prefix owL --workers 8
 *   npm run owlswap:grind-wallets -- --only wallet
 *   npm run owlswap:grind-wallets -- --only escrow
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { cpus } from 'node:os'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { fileURLToPath } from 'node:url'

const DEFAULT_PREFIX = 'owL'
const BASE58_FORBIDDEN = /[0OIl]/

type Role = 'wallet' | 'escrow'

const ROLE_META: Record<
  Role,
  {
    fileStem: string
    title: string
    publicEnv: string
    secretEnv: string
  }
> = {
  wallet: {
    fileStem: 'owlswap-wallet-keypair',
    title: 'OWLSWAP OPS WALLET',
    publicEnv: 'OWLSWAP_WALLET',
    secretEnv: 'OWLSWAP_SECRET_KEY',
  },
  escrow: {
    fileStem: 'owlswap-escrow-keypair',
    title: 'OWLSWAP ESCROW',
    publicEnv: 'OWLSWAP_ESCROW_WALLET',
    secretEnv: 'OWLSWAP_ESCROW_SECRET_KEY',
  },
}

function parseArgs(argv: string[]) {
  let prefix = DEFAULT_PREFIX
  let caseSensitive = true
  let outDir = join(process.cwd(), '.local')
  let workers = Math.max(2, Math.min(cpus().length || 4, 12))
  let only: Role | 'both' = 'both'
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--prefix' && argv[i + 1]) prefix = argv[++i]!
    else if (a === '--case-insensitive' || a === '-i') caseSensitive = false
    else if (a === '--case-sensitive') caseSensitive = true
    else if (a === '--out' && argv[i + 1]) outDir = argv[++i]!
    else if (a === '--workers' && argv[i + 1]) workers = Math.max(1, Number(argv[++i]))
    else if (a === '--only' && argv[i + 1]) {
      const v = argv[++i]!
      if (v !== 'wallet' && v !== 'escrow' && v !== 'both') {
        throw new Error(`--only must be wallet | escrow | both (got "${v}")`)
      }
      only = v
    } else if (a === '--help' || a === '-h') {
      console.log(`Grind OwlSwap vanity wallets (ops + escrow)

  --prefix <str>   Default: ${DEFAULT_PREFIX} (reads as Owl; O/l not in base58)
  --workers <n>    Parallel workers (default: CPU count)
  --only <role>    wallet | escrow | both (default: both)
  --case-insensitive / -i
  --out <dir>      Default: .local`)
      process.exit(0)
    }
  }
  return { prefix, caseSensitive, outDir, workers, only }
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
  async function grindOne(
    role: Role,
    opts: { prefix: string; caseSensitive: boolean; outDir: string; workers: number }
  ): Promise<{ publicKey: string; secretKey: number[]; attempts: number; elapsedSec: string }> {
    const { prefix, caseSensitive, outDir, workers } = opts
    const meta = ROLE_META[role]

    console.log(
      `\n[${role}] Grinding "${prefix}" with ${workers} workers (${caseSensitive ? 'case-sensitive' : 'case-insensitive'})…`
    )

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

    const result = await new Promise<{
      publicKey: string
      secretKey: number[]
      attempts: number
      elapsedSec: string
    }>((resolve, reject) => {
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
                `  [${role}] … ${totalAttempts.toLocaleString()} tried (~${Math.round(rate).toLocaleString()}/s)`
              )
              lastLog = now
            }
            return
          }
          if (msg.type === 'found' && msg.address && msg.secretKey) {
            done = true
            totalAttempts += msg.attempts || 0
            const elapsedSec = ((Date.now() - started) / 1000).toFixed(1)
            stopAll()
            resolve({
              publicKey: msg.address,
              secretKey: msg.secretKey,
              attempts: totalAttempts,
              elapsedSec,
            })
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

    mkdirSync(outDir, { recursive: true })
    const jsonPath = join(outDir, `${meta.fileStem}.json`)
    const metaPath = join(outDir, `${meta.fileStem}.meta.json`)
    const txtPath = join(outDir, `${meta.fileStem}.txt`)
    if (existsSync(jsonPath) || existsSync(metaPath) || existsSync(txtPath)) {
      console.warn(`  Warning: overwriting existing ${meta.fileStem}.* in ${outDir}`)
    }

    const secretB58 = bs58.encode(Uint8Array.from(result.secretKey))

    writeFileSync(jsonPath, JSON.stringify(result.secretKey), { mode: 0o600 })
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          role,
          publicKey: result.publicKey,
          secretKeyBase58: secretB58,
          prefix,
          attempts: result.attempts,
          generatedAt: new Date().toISOString(),
          env: {
            [meta.publicEnv]: result.publicKey,
            [meta.secretEnv]: JSON.stringify(result.secretKey),
          },
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    writeFileSync(
      txtPath,
      [
        `${meta.title} VANITY KEYPAIR — KEEP SECRET`,
        `publicKey=${result.publicKey}`,
        `${meta.secretEnv}=${JSON.stringify(result.secretKey)}`,
        `${meta.publicEnv}=${result.publicKey}`,
        `attempts=${result.attempts}`,
        `elapsedSec=${result.elapsedSec}`,
        '',
      ].join('\n'),
      { mode: 0o600 }
    )

    console.log(
      `  [${role}] Found after ${result.attempts.toLocaleString()} attempts in ${result.elapsedSec}s`
    )
    console.log(`  Public key:  ${result.publicKey}`)
    console.log(`  Wrote:       ${jsonPath}`)

    return result
  }

  async function main() {
    const { prefix, caseSensitive, outDir, workers, only } = parseArgs(process.argv.slice(2))
    assertGrindablePrefix(prefix)

    console.log('OwlSwap vanity grind')
    console.log('Note: Solana addresses cannot contain O or l — owL ≈ Owl.')

    const roles: Role[] =
      only === 'both' ? ['wallet', 'escrow'] : only === 'wallet' ? ['wallet'] : ['escrow']

    const found: Partial<Record<Role, { publicKey: string; secretKey: number[] }>> = {}

    for (const role of roles) {
      const r = await grindOne(role, { prefix, caseSensitive, outDir, workers })
      found[role] = { publicKey: r.publicKey, secretKey: r.secretKey }
    }

    // Combined secrets file (gitignored via .local / .secrets)
    const secretsDir = join(process.cwd(), '.secrets')
    mkdirSync(secretsDir, { recursive: true })
    const secretsPath = join(secretsDir, 'owlswap-wallets.json')
    const existing = existsSync(secretsPath)
      ? (JSON.parse(readFileSync(secretsPath, 'utf8')) as Record<string, unknown>)
      : {}

    const payload = {
      ...existing,
      generatedAt: new Date().toISOString(),
      prefix,
      network: 'mainnet — fund these addresses before production use',
      wallets: {
        ...((existing.wallets as Record<string, unknown>) ?? {}),
        ...(found.wallet
          ? {
              ops: {
                publicKey: found.wallet.publicKey,
                secretKeyJson: JSON.stringify(found.wallet.secretKey),
                env: {
                  OWLSWAP_WALLET: found.wallet.publicKey,
                  OWLSWAP_SECRET_KEY: JSON.stringify(found.wallet.secretKey),
                },
              },
            }
          : {}),
        ...(found.escrow
          ? {
              escrow: {
                publicKey: found.escrow.publicKey,
                secretKeyJson: JSON.stringify(found.escrow.secretKey),
                env: {
                  OWLSWAP_ESCROW_WALLET: found.escrow.publicKey,
                  OWLSWAP_ESCROW_SECRET_KEY: JSON.stringify(found.escrow.secretKey),
                },
              },
            }
          : {}),
      },
    }

    writeFileSync(secretsPath, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 })

    console.log('\n--- OwlSwap vanity complete ---')
    if (found.wallet) console.log(`Ops wallet:  ${found.wallet.publicKey}`)
    if (found.escrow) console.log(`Escrow:      ${found.escrow.publicKey}`)
    console.log(`Secrets:     ${secretsPath}`)
    console.log(`Keypairs:    ${outDir}/owlswap-*-keypair.*`)
    console.log('\nNext: npm run owlswap:install-env  (merges into .env.local, never prints secrets)')
    console.log('Fund both with SOL for fees before production use.')
  }

  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
