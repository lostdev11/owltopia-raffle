/**
 * Switchboard On-Demand randomness (commit → reveal) for owltopia-draw-v3-vrf.
 * Platform pays via funds/prize escrow keypair. Pure client path — no custom raffle program yet.
 */
import { Keypair, PublicKey, Connection } from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getFundsEscrowKeypair } from '@/lib/raffles/funds-escrow'
import { getPrizeEscrowKeypair } from '@/lib/raffles/prize-escrow'
import { seedFromVrfHex } from '@/lib/raffles/draw/vrf-seed'

export const VRF_PROVIDER_SWITCHBOARD = 'switchboard' as const

export type SwitchboardVrfRequestResult =
  | {
      ok: true
      provider: typeof VRF_PROVIDER_SWITCHBOARD
      randomnessAccount: string
      /** Base58-encoded secret key of the randomness account (needed to sign reveal / close). */
      randomnessSecretKeyBase58: string
      commitTx: string
      seedSlot?: number
    }
  | { ok: false; error: string }

export type SwitchboardVrfRevealResult =
  | {
      ok: true
      provider: typeof VRF_PROVIDER_SWITCHBOARD
      randomnessAccount: string
      revealTx: string
      valueHex: string
      drawSeed: string
    }
  | { ok: false; error: string; retryable: boolean }

function resolveVrfPayer(): Keypair | null {
  return getFundsEscrowKeypair() ?? getPrizeEscrowKeypair() ?? null
}

function isDevnetRpc(url: string): boolean {
  return /devnet/i.test(url)
}

async function loadSb() {
  return import('@switchboard-xyz/on-demand')
}

async function loadAnchorWallet(payer: Keypair) {
  // Bundled with on-demand (anchor 0.31)
  const anchor = await import('@coral-xyz/anchor-31')
  return new anchor.Wallet(payer)
}

async function loadSbProgram(connection: Connection, payer: Keypair) {
  const sb = await loadSb()
  const wallet = await loadAnchorWallet(payer)
  return sb.AnchorUtils.loadProgramFromConnection(connection, wallet)
}

/**
 * Create a Switchboard randomness account and commit to the next slothash.
 * Persist randomnessSecretKeyBase58 with the pending request (service-role secrets table or raffle row encrypted later).
 * For v1 of this integration we store the secret in raffle_draw_secrets.seed_hex prefixed — better: separate column.
 */
export async function switchboardCommitRandomness(): Promise<SwitchboardVrfRequestResult> {
  const payer = resolveVrfPayer()
  if (!payer) {
    return {
      ok: false,
      error:
        'No escrow key configured for VRF fees (set FUNDS_ESCROW_SECRET_KEY or PRIZE_ESCROW_SECRET_KEY)',
    }
  }

  try {
    const sb = await loadSb()
    const connection = getSolanaConnection()
    const rpcUrl = resolveServerSolanaRpcUrl()
    const program = await loadSbProgram(connection, payer)
    const queue = await sb.getDefaultQueue(rpcUrl)
    const queuePubkey = queue.pubkey

    const rngKp = Keypair.generate()
    const [randomness, createIx] = await sb.Randomness.create(
      program,
      rngKp,
      queuePubkey,
      payer.publicKey
    )
    const commitIx = await randomness.commitIx(queuePubkey)

    const createTx = await sb.asV0Tx({
      connection,
      ixs: [createIx],
      signers: [payer, rngKp],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    })
    const createSig = await connection.sendTransaction(createTx, {
      skipPreflight: false,
      preflightCommitment: 'processed',
      maxRetries: 3,
    })
    await connection.confirmTransaction(createSig, 'confirmed')

    const commitTx = await sb.asV0Tx({
      connection,
      ixs: [commitIx],
      signers: [payer],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    })
    const commitSig = await connection.sendTransaction(commitTx, {
      skipPreflight: false,
      preflightCommitment: 'processed',
      maxRetries: 3,
    })
    await connection.confirmTransaction(commitSig, 'confirmed')

    let seedSlot: number | undefined
    try {
      const data = await randomness.loadData()
      seedSlot = Number(data?.seedSlot ?? data?.seed_slot ?? undefined)
      if (!Number.isFinite(seedSlot)) seedSlot = undefined
    } catch {
      // optional
    }

    const bs58 = (await import('bs58')).default
    return {
      ok: true,
      provider: VRF_PROVIDER_SWITCHBOARD,
      randomnessAccount: rngKp.publicKey.toBase58(),
      randomnessSecretKeyBase58: bs58.encode(rngKp.secretKey),
      commitTx: commitSig,
      seedSlot,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Switchboard commit failed',
    }
  }
}

export async function switchboardRevealRandomness(params: {
  randomnessAccount: string
  randomnessSecretKeyBase58: string
  /** Wait/retry budget for oracle generation (ms). */
  maxWaitMs?: number
}): Promise<SwitchboardVrfRevealResult> {
  const payer = resolveVrfPayer()
  if (!payer) {
    return {
      ok: false,
      error: 'No escrow key configured for VRF reveal',
      retryable: false,
    }
  }

  const maxWaitMs = params.maxWaitMs ?? 45_000
  const started = Date.now()

  try {
    const sb = await loadSb()
    const connection = getSolanaConnection()
    const rpcUrl = resolveServerSolanaRpcUrl()
    const program = await loadSbProgram(connection, payer)
    const bs58 = (await import('bs58')).default
    const rngKp = Keypair.fromSecretKey(bs58.decode(params.randomnessSecretKeyBase58.trim()))
    const accountPk = new PublicKey(params.randomnessAccount.trim())
    if (!rngKp.publicKey.equals(accountPk)) {
      return {
        ok: false,
        error: 'randomness secret key does not match account pubkey',
        retryable: false,
      }
    }

    const randomness = new sb.Randomness(program, accountPk)

    let lastErr = 'Randomness not ready'
    while (Date.now() - started < maxWaitMs) {
      try {
        const revealIx = await randomness.revealIx(payer.publicKey)
        const revealTx = await sb.asV0Tx({
          connection,
          ixs: [revealIx],
          signers: [payer],
          computeUnitPrice: 75_000,
          computeUnitLimitMultiple: 1.3,
        })
        const revealSig = await connection.sendTransaction(revealTx, {
          skipPreflight: false,
          preflightCommitment: 'processed',
          maxRetries: 3,
        })
        await connection.confirmTransaction(revealSig, 'confirmed')

        const inspected = await sb.inspectSolanaRandomness({
          randomnessId: accountPk,
          solanaRPCUrl: rpcUrl,
        })
        const valueHex =
          (inspected as { state?: { valueHex?: string } })?.state?.valueHex ||
          (inspected as { valueHex?: string })?.valueHex ||
          ''
        if (!valueHex) {
          // Fallback: loadData
          const data = await randomness.loadData()
          const raw =
            data?.value ??
            data?.currentValue ??
            data?.result ??
            null
          if (raw && (Buffer.isBuffer(raw) || raw instanceof Uint8Array || Array.isArray(raw))) {
            const hex = Buffer.from(raw as Uint8Array).toString('hex')
            return {
              ok: true,
              provider: VRF_PROVIDER_SWITCHBOARD,
              randomnessAccount: accountPk.toBase58(),
              revealTx: revealSig,
              valueHex: hex,
              drawSeed: seedFromVrfHex(hex),
            }
          }
          return {
            ok: false,
            error: 'Reveal succeeded but valueHex missing from inspection',
            retryable: true,
          }
        }

        return {
          ok: true,
          provider: VRF_PROVIDER_SWITCHBOARD,
          randomnessAccount: accountPk.toBase58(),
          revealTx: revealSig,
          valueHex,
          drawSeed: seedFromVrfHex(valueHex),
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : 'Reveal attempt failed'
        await new Promise((r) => setTimeout(r, 2500))
      }
    }

    return {
      ok: false,
      error: `VRF reveal timed out after ${maxWaitMs}ms: ${lastErr}`,
      retryable: true,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Switchboard reveal failed',
      retryable: true,
    }
  }
}

export function switchboardClusterHint(): 'devnet' | 'mainnet' {
  return isDevnetRpc(resolveServerSolanaRpcUrl()) ? 'devnet' : 'mainnet'
}
