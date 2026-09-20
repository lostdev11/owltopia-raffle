/**
 * Switchboard randomness oracle selection helpers.
 *
 * SDK `Queue.selectRandomnessOracle()` rejects every queue member when
 * heartbeats / TEE quotes are stale — which has left raffles stuck with
 * "No eligible randomness oracle candidates were found" even though the
 * queue still lists oracles with gateway URLs. We fall back to the
 * freshest heartbeat that still has a gateway so commitIx can proceed;
 * reveal may still fail if the gateway is down, and callers can then use
 * the local-seed recovery path.
 */
import type { PublicKey } from '@solana/web3.js'

export const SWITCHBOARD_ORACLE_UNAVAILABLE_RE =
  /No eligible randomness oracle candidates were found|No oracles found on queue|No randomness oracle candidates were provided/i

export function isSwitchboardOracleFleetUnavailable(
  error: string | null | undefined
): boolean {
  return SWITCHBOARD_ORACLE_UNAVAILABLE_RE.test((error ?? '').trim())
}

type OracleLike = {
  pubkey: PublicKey
  loadData: () => Promise<{
    gatewayUri: Uint8Array | number[] | Buffer
    lastHeartbeat: { toNumber: () => number }
    enclave: { verificationStatus: number; validUntil: { toNumber: () => number } }
    isOnQueue: boolean
  }>
}

type QueueLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: any
  fetchOracleKeys: () => Promise<PublicKey[]>
  selectRandomnessOracle: () => Promise<{ oracle: OracleLike; metadata?: unknown }>
}

type OracleCtor = {
  // SDK Oracle.loadMany is typed against Anchor Program; keep this structural.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadMany: (program: any, keys: PublicKey[]) => Promise<
    Array<{
      gatewayUri: Uint8Array | number[] | Buffer
      lastHeartbeat: { toNumber: () => number }
      enclave: { verificationStatus: number; validUntil: { toNumber: () => number } }
      isOnQueue: boolean
    } | null>
  >
}

function gatewayUrlFromUri(gatewayUri: Uint8Array | number[] | Buffer): string {
  return Buffer.from(gatewayUri as Uint8Array)
    .toString('utf8')
    .replace(/\0+$/, '')
    .trim()
}

/**
 * Prefer SDK healthy selection; on fleet-unavailable errors, pick the queue
 * member with the newest heartbeat that still advertises a gateway URL.
 */
export async function resolveSwitchboardCommitOracle(params: {
  queue: QueueLike
  Oracle: OracleCtor
}): Promise<PublicKey> {
  const { queue, Oracle } = params
  try {
    const selected = await queue.selectRandomnessOracle()
    return selected.oracle.pubkey
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!isSwitchboardOracleFleetUnavailable(msg)) {
      throw err instanceof Error ? err : new Error(msg)
    }
  }

  const keys = await queue.fetchOracleKeys()
  if (keys.length === 0) {
    throw new Error('No oracles found on queue')
  }

  const loaded = await Oracle.loadMany(queue.program, keys)
  const nowUnix = Math.floor(Date.now() / 1000)

  type Ranked = {
    key: PublicKey
    heartbeat: number
    verified: boolean
    quoteFresh: boolean
    onQueue: boolean
  }
  const ranked: Ranked[] = []
  for (let i = 0; i < keys.length; i++) {
    const data = loaded[i]
    if (!data) continue
    const gatewayUrl = gatewayUrlFromUri(data.gatewayUri)
    if (!gatewayUrl) continue
    ranked.push({
      key: keys[i]!,
      heartbeat: data.lastHeartbeat.toNumber(),
      verified: data.enclave.verificationStatus === 4,
      quoteFresh: data.enclave.validUntil.toNumber() > nowUnix,
      onQueue: data.isOnQueue === true,
    })
  }

  if (ranked.length === 0) {
    throw new Error('No eligible randomness oracle candidates were found')
  }

  ranked.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1
    if (a.quoteFresh !== b.quoteFresh) return a.quoteFresh ? -1 : 1
    if (a.onQueue !== b.onQueue) return a.onQueue ? -1 : 1
    return b.heartbeat - a.heartbeat
  })

  return ranked[0]!.key
}
