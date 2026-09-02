/**
 * Switchboard On-Demand randomness (commit → reveal) for owltopia-draw-v3-vrf.
 * Platform pays via funds/prize escrow keypair. Pure client path — no custom raffle program yet.
 */
import {
  Keypair,
  PublicKey,
  Connection,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  SystemProgram,
} from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getFundsEscrowKeypair } from '@/lib/raffles/funds-escrow'
import { getPrizeEscrowKeypair } from '@/lib/raffles/prize-escrow'
import { seedFromVrfHex, extractVrfValueHex, isSwitchboardRandomnessRevealed } from '@/lib/raffles/draw/vrf-seed'
import {
  resolveVrfRevealWaitMs,
  vrfRevealRetryDelayMs,
  isSwitchboardGatewayTransientError,
  isInvalidVrfSecpSignatureError,
} from '@/lib/raffles/draw/vrf-retry-policy'

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

/**
 * Minimal Anchor Wallet adapter from a Keypair.
 *
 * Do NOT use `new (await import('@coral-xyz/anchor-31')).Wallet(payer)`.
 * Anchor's package.json "browser" build omits NodeWallet, so Next.js server
 * bundling can resolve Wallet as undefined →
 * "(intermediate value).Wallet is not a constructor" and VRF draw fails.
 */
function isVersionedTransaction(
  tx: Transaction | VersionedTransaction
): tx is VersionedTransaction {
  return 'version' in tx
}

export function keypairWallet(payer: Keypair) {
  return {
    publicKey: payer.publicKey,
    payer,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (isVersionedTransaction(tx)) {
        tx.sign([payer])
      } else {
        tx.partialSign(payer)
      }
      return tx
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      for (const tx of txs) {
        await this.signTransaction(tx)
      }
      return txs
    },
  }
}

async function loadSbProgram(connection: Connection, payer: Keypair) {
  const sb = await loadSb()
  return sb.AnchorUtils.loadProgramFromConnection(connection, keypairWallet(payer))
}

function normalizeGatewayUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/$/, '')
  return trimmed || null
}

/** Collect oracle + Crossbar gateway URLs — assigned oracle gateway is often the one returning 503. */
async function collectRevealGatewayUrls(
  program: Awaited<ReturnType<typeof loadSbProgram>>,
  data: {
    oracle: PublicKey
    queue: PublicKey
    gatewayUri?: Uint8Array | number[] | Buffer | null
  }
): Promise<string[]> {
  const sb = await loadSb()
  const { CrossbarClient } = await import('@switchboard-xyz/common')
  const urls: string[] = []
  const seen = new Set<string>()
  const add = (raw: string | null | undefined) => {
    const normalized = normalizeGatewayUrl(raw)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    urls.push(normalized)
  }

  // Prefer Crossbar-published gateways (health-checked) before the oracle's on-chain URI.
  try {
    const crossbar = CrossbarClient.default()
    const network = isDevnetRpc(resolveServerSolanaRpcUrl()) ? 'devnet' : 'mainnet'
    const fromCrossbar = await crossbar.fetchGateways(network)
    for (const gateway of fromCrossbar) add(gateway)
  } catch {
    // ignore
  }

  try {
    const queue = new sb.Queue(program, data.queue)
    const crossbar = CrossbarClient.default()
    const gateway = await queue.fetchGatewayByLatestVersion(crossbar)
    add(gateway.gatewayUrl)
  } catch {
    // ignore
  }

  if (data.gatewayUri) {
    add(Buffer.from(data.gatewayUri).toString('utf8').replace(/\0+$/, ''))
  } else {
    try {
      const oracle = new sb.Oracle(program, data.oracle)
      const oracleData = await oracle.loadData()
      add(Buffer.from(oracleData.gatewayUri as Uint8Array).toString('utf8').replace(/\0+$/, ''))
    } catch {
      // ignore
    }
  }

  return urls
}

async function buildRevealIxWithGatewayFallback(params: {
  program: Awaited<ReturnType<typeof loadSbProgram>>
  randomness: {
    pubkey: PublicKey
    loadData: () => Promise<{
      oracle: PublicKey
      queue: PublicKey
      authority: PublicKey
      seedSlothash: Uint8Array | number[]
      seedSlot: { toNumber: () => number } | number | bigint
    }>
  }
  payer: PublicKey
  gatewayUrls: string[]
  rpcUrl: string
}): Promise<TransactionInstruction> {
  const sb = await loadSb()
  const { Gateway } = await import('@switchboard-xyz/common')
  const { getAssociatedTokenAddressSync } = await import('@solana/spl-token')
  const bs58 = (await import('bs58')).default
  const data = await params.randomness.loadData()
  const seedSlotRaw = data.seedSlot
  const seedSlot =
    typeof seedSlotRaw === 'object' && seedSlotRaw != null && 'toNumber' in seedSlotRaw
      ? seedSlotRaw.toNumber()
      : Number(seedSlotRaw)
  if (!Number.isFinite(seedSlot) || seedSlot <= 0) {
    throw new Error('Randomness not committed yet (missing seed slot)')
  }

  const revealParams = {
    randomnessAccount: params.randomness.pubkey,
    slothash: bs58.encode(Buffer.from(data.seedSlothash)),
    slot: seedSlot,
    rpc: params.rpcUrl,
  }

  let lastErr = 'No gateway URLs available'
  for (const gatewayUrl of params.gatewayUrls) {
    try {
      const gateway = new Gateway(gatewayUrl)
      const gatewayRevealResponse = await gateway.fetchRandomnessReveal(revealParams)
      const stats = PublicKey.findProgramAddressSync(
        [Buffer.from('OracleRandomnessStats'), data.oracle.toBuffer()],
        params.program.programId
      )[0]
      return params.program.instruction.randomnessReveal(
        {
          signature: Buffer.from(gatewayRevealResponse.signature, 'base64'),
          recoveryId: gatewayRevealResponse.recovery_id,
          value: gatewayRevealResponse.value,
        },
        {
          accounts: {
            randomness: params.randomness.pubkey,
            oracle: data.oracle,
            queue: data.queue,
            stats,
            authority: data.authority,
            payer: params.payer,
            recentSlothashes: sb.SPL_SYSVAR_SLOT_HASHES_ID,
            systemProgram: SystemProgram.programId,
            rewardEscrow: getAssociatedTokenAddressSync(
              sb.SOL_NATIVE_MINT,
              params.randomness.pubkey
            ),
            tokenProgram: sb.SPL_TOKEN_PROGRAM_ID,
            associatedTokenProgram: sb.SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
            wrappedSolMint: sb.SOL_NATIVE_MINT,
            programState: sb.State.keyFromSeed(params.program),
          },
        }
      )
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'Gateway reveal failed'
    }
  }

  throw new Error(lastErr)
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

    // Must pass payer as commit authority. Bare `commitIx(queue)` calls loadData()
    // on the randomness account before create is on-chain →
    // "Account does not exist or has no data <pubkey>".
    // createAndCommitIxs does this correctly; keep an explicit fallback.
    let randomness: InstanceType<typeof sb.Randomness>
    let rngKp: Keypair
    let createIx: Awaited<ReturnType<typeof sb.Randomness.create>>[1]
    let commitIx: Awaited<ReturnType<InstanceType<typeof sb.Randomness>['commitIx']>>
    if (typeof sb.Randomness.createAndCommitIxs === 'function') {
      const [account, accountKp, ixs] = await sb.Randomness.createAndCommitIxs(
        program,
        queuePubkey,
        payer.publicKey
      )
      randomness = account
      rngKp = accountKp
      createIx = ixs[0]!
      commitIx = ixs[1]!
    } else {
      rngKp = Keypair.generate()
      const created = await sb.Randomness.create(
        program,
        rngKp,
        queuePubkey,
        payer.publicKey
      )
      randomness = created[0]
      createIx = created[1]
      commitIx = await randomness.commitIx(queuePubkey, payer.publicKey)
    }

    // Create must land before commit (commitIx accounts assume the account exists).
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

    // Oracle needs a moment after commit before reveal signatures validate on-chain.
    await new Promise((r) => setTimeout(r, 4000))

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
    const raw = e instanceof Error ? e.message : 'Switchboard commit failed'
    const hint = /Account does not exist or has no data/i.test(raw)
      ? ' (Switchboard randomness commit failed before/while creating the on-chain account — retry Force draw; if this persists, check RPC cluster matches mainnet and escrow can pay rent)'
      : ''
    return {
      ok: false,
      error: `${raw}${hint}`,
    }
  }
}

export async function switchboardRevealRandomness(params: {
  randomnessAccount: string
  randomnessSecretKeyBase58: string
  /** Wait/retry budget for oracle generation (ms). */
  maxWaitMs?: number
  /** Optional known reveal tx (e.g. when recovering an already-revealed account). */
  knownRevealTx?: string | null
}): Promise<SwitchboardVrfRevealResult> {
  const payer = resolveVrfPayer()
  if (!payer) {
    return {
      ok: false,
      error: 'No escrow key configured for VRF reveal',
      retryable: false,
    }
  }

  const maxWaitMs = resolveVrfRevealWaitMs(params.maxWaitMs)
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

    const readRevealedValue = async (
      revealTx: string
    ): Promise<SwitchboardVrfRevealResult | null> => {
      const data = await randomness.loadData()
      if (!isSwitchboardRandomnessRevealed(data)) return null
      const fromAccount = extractVrfValueHex(data.value)
      if (fromAccount) {
        return {
          ok: true,
          provider: VRF_PROVIDER_SWITCHBOARD,
          randomnessAccount: accountPk.toBase58(),
          revealTx,
          valueHex: fromAccount,
          drawSeed: seedFromVrfHex(fromAccount),
        }
      }
      return null
    }

    // Already revealed on-chain (common after a prior attempt where inspect failed).
    try {
      const existing = await readRevealedValue(
        (params.knownRevealTx ?? '').trim() || ''
      )
      if (existing) return existing
    } catch {
      // Account may not be ready yet — fall through to reveal loop.
    }

    let lastErr = 'Randomness not ready'
    let lastRevealSig = ''
    let attemptIndex = 0
    let gatewayUrls: string[] | null = null
    while (Date.now() - started < maxWaitMs) {
      try {
        // Re-check each iteration — another worker may have revealed.
        const raced = await readRevealedValue(lastRevealSig)
        if (raced) return raced

        if (!gatewayUrls) {
          const data = await randomness.loadData()
          gatewayUrls = await collectRevealGatewayUrls(program, data)
        }

        const revealIx = await buildRevealIxWithGatewayFallback({
          program,
          randomness,
          payer: payer.publicKey,
          gatewayUrls,
          rpcUrl,
        })
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
        lastRevealSig = revealSig

        // Prefer on-chain account data. inspectSolanaRandomness often throws
        // "Invalid account discriminator" after reveal (oracle field cleared).
        const fromChain = await readRevealedValue(revealSig)
        if (fromChain) return fromChain

        try {
          const inspected = await sb.inspectSolanaRandomness({
            randomnessId: accountPk,
            solanaRPCUrl: rpcUrl,
          })
          const valueHex =
            (inspected as { state?: { valueHex?: string } })?.state?.valueHex ||
            (inspected as { valueHex?: string })?.valueHex ||
            ''
          if (valueHex) {
            return {
              ok: true,
              provider: VRF_PROVIDER_SWITCHBOARD,
              randomnessAccount: accountPk.toBase58(),
              revealTx: revealSig,
              valueHex,
              drawSeed: seedFromVrfHex(valueHex),
            }
          }
        } catch (inspectErr) {
          lastErr =
            inspectErr instanceof Error
              ? `inspect failed after reveal: ${inspectErr.message}`
              : 'inspect failed after reveal'
        }

        lastErr = 'Reveal tx landed but value not readable yet'
      } catch (e) {
        lastErr = e instanceof Error ? e.message : 'Reveal attempt failed'
        if (isInvalidVrfSecpSignatureError(lastErr)) {
          return {
            ok: false,
            error: lastErr,
            retryable: true,
          }
        }
        // If revealIx fails because oracle was cleared, check whether value is already set.
        try {
          const recovered = await readRevealedValue(lastRevealSig)
          if (recovered) return recovered
        } catch {
          // ignore
        }
      }

      const delayMs = vrfRevealRetryDelayMs({ attemptIndex, lastError: lastErr })
      attemptIndex += 1
      // Stop early when the next sleep would blow the budget with no remaining attempt.
      if (Date.now() - started + delayMs >= maxWaitMs) break
      await new Promise((r) => setTimeout(r, delayMs))
    }

    const gatewayHint = isSwitchboardGatewayTransientError(lastErr)
      ? ` (Switchboard oracle gateway flaky — tried ${gatewayUrls?.length ?? 0} gateways; auto-retry will re-commit if this stays down)`
      : ''
    return {
      ok: false,
      error: `VRF reveal timed out after ${maxWaitMs}ms: ${lastErr}${gatewayHint}`,
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
