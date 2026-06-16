import bs58 from 'bs58'
import type { Signer } from '@metaplex-foundation/umi'
import { Connection, PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js'

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/

function readSignatureCandidate(value: unknown): string | null {
  if (typeof value === 'string' && SIG_RE.test(value)) return value
  if (value instanceof Uint8Array) return bs58.encode(value)
  return null
}

export function extractTxSignatureFromUnknownError(error: unknown, depth = 0): string | null {
  if (error == null || depth > 5) return null

  if (typeof error === 'string') {
    const match = error.match(/\b([1-9A-HJ-NP-Za-km-z]{87,88})\b/)
    return match?.[1] && SIG_RE.test(match[1]) ? match[1] : null
  }

  if (typeof error !== 'object') return null

  const e = error as Record<string, unknown>
  for (const key of ['signature', 'transactionSignature', 'txSignature', 'txid'] as const) {
    const sig = readSignatureCandidate(e[key])
    if (sig) return sig
  }

  for (const key of ['cause', 'error', 'innerError', 'data', 'context'] as const) {
    const nested = extractTxSignatureFromUnknownError(e[key], depth + 1)
    if (nested) return nested
  }

  const msg = error instanceof Error ? error.message : typeof e.message === 'string' ? e.message : null
  if (msg) {
    const fromMsg = extractTxSignatureFromUnknownError(msg, depth + 1)
    if (fromMsg) return fromMsg
  }

  return null
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll until a submitted signature reaches the requested commitment (no re-sign). */
export async function pollTransactionSignatureStatus(
  rpcUrl: string,
  signature: string,
  options?: { maxWaitMs?: number; intervalMs?: number; minCommitment?: 'processed' | 'confirmed' }
): Promise<boolean> {
  const conn = new Connection(rpcUrl, 'confirmed')
  const maxWaitMs = Math.max(2000, options?.maxWaitMs ?? 12000)
  const intervalMs = Math.max(200, options?.intervalMs ?? 350)
  const minCommitment = options?.minCommitment ?? 'confirmed'
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await conn.getSignatureStatuses([signature])
      const status = res?.value?.[0]
      if (status?.err) return false
      const level = status?.confirmationStatus
      if (minCommitment === 'processed') {
        if (level === 'processed' || level === 'confirmed' || level === 'finalized') return true
      } else if (level === 'confirmed' || level === 'finalized') {
        return true
      }
    } catch {
      // transient RPC — keep polling
    }
    await sleep(intervalMs)
  }
  return false
}

/** @deprecated Use pollTransactionSignatureStatus */
export async function pollTransactionSignatureConfirmed(
  rpcUrl: string,
  signature: string,
  options?: { maxWaitMs?: number; intervalMs?: number }
): Promise<boolean> {
  return pollTransactionSignatureStatus(rpcUrl, signature, {
    ...options,
    minCommitment: 'confirmed',
  })
}

/** Poll for mint accounts we generated before send — they exist only after a successful mintV2. */
export async function detectPlannedMintAccounts(
  rpcUrl: string,
  plannedMintB58s: string[],
  options?: { attempts?: number; delayMs?: number }
): Promise<string[]> {
  if (plannedMintB58s.length === 0) return []
  const conn = new Connection(rpcUrl, 'confirmed')
  const attempts = Math.max(1, options?.attempts ?? 8)
  const delayMs = Math.max(500, options?.delayMs ?? 1500)

  for (let attempt = 0; attempt < attempts; attempt++) {
    const found: string[] = []
    await Promise.all(
      plannedMintB58s.map(async (mintB58) => {
        try {
          const info = await conn.getAccountInfo(new PublicKey(mintB58), 'confirmed')
          if (info) found.push(mintB58)
        } catch {
          // ignore per-mint read failures
        }
      })
    )
    if (found.length > 0) return found
    if (attempt < attempts - 1) await sleep(delayMs)
  }
  return []
}

/** Find a recent successful wallet tx that touched the CM or one of the planned mint addresses. */
export async function findRecentCandyMachineMintSignature(
  rpcUrl: string,
  walletB58: string,
  candyMachineB58: string,
  plannedMintB58s: string[],
  maxAgeSec = 240
): Promise<string | null> {
  try {
    const conn = new Connection(rpcUrl, 'confirmed')
    const owner = new PublicKey(walletB58)
    const sigs = await conn.getSignaturesForAddress(owner, { limit: 20 })
    const now = Math.floor(Date.now() / 1000)
    const planned = new Set(plannedMintB58s)
    const cm = candyMachineB58.trim()

    for (const entry of sigs) {
      if (!entry.signature || entry.err) continue
      if (entry.blockTime != null && now - entry.blockTime > maxAgeSec) continue

      const tx = await conn.getTransaction(entry.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
      if (!tx?.transaction) continue

      const keys = tx.transaction.message.getAccountKeys({
        accountKeysFromLookups: tx.meta?.loadedAddresses,
      })
      const allKeys = [
        ...keys.staticAccountKeys,
        ...(keys.accountKeysFromLookups?.writable ?? []),
        ...(keys.accountKeysFromLookups?.readonly ?? []),
      ]
      const touched = allKeys.some((k) => {
        const b58 = k.toBase58()
        return b58 === cm || planned.has(b58)
      })
      if (touched) return entry.signature
    }
  } catch {
    return null
  }
  return null
}

function parseMintedNftsFromParsedTx(parsed: ParsedTransactionWithMeta, walletB58: string): string[] {
  const meta = parsed.meta
  if (!meta) return []

  const preMints = new Set(
    (meta.preTokenBalances ?? [])
      .filter((b) => b.owner === walletB58 && b.mint)
      .map((b) => b.mint!)
  )

  const minted: string[] = []
  for (const bal of meta.postTokenBalances ?? []) {
    if (bal.owner !== walletB58 || !bal.mint || preMints.has(bal.mint)) continue
    const amount = bal.uiTokenAmount?.amount ?? '0'
    if (amount === '1') minted.push(bal.mint)
  }
  return minted
}

/**
 * Wallet-only fallback when planned mint pubkeys are unavailable (Phantom/Solflare disconnect).
 * Scans recent wallet transactions for the Candy Machine and parses minted NFT addresses.
 */
export async function recoverRecentCandyMachineMintForWallet(params: {
  rpcUrl: string
  walletB58: string
  candyMachineB58: string
  maxAgeSec?: number
}): Promise<RecoveredCandyMachineMint | null> {
  const txSignature = await findRecentCandyMachineMintSignature(
    params.rpcUrl,
    params.walletB58,
    params.candyMachineB58,
    [],
    params.maxAgeSec ?? 300
  )
  if (!txSignature) return null

  try {
    const conn = new Connection(params.rpcUrl, 'confirmed')
    const parsed = await conn.getParsedTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (!parsed?.meta || parsed.meta.err) return null

    const mintedNftMints = parseMintedNftsFromParsedTx(parsed, params.walletB58)
    if (mintedNftMints.length === 0) {
      return { txSignatures: [txSignature], mintedNftMints: [] }
    }
    return { txSignatures: [txSignature], mintedNftMints }
  } catch {
    return { txSignatures: [txSignature], mintedNftMints: [] }
  }
}

export type RecoveredCandyMachineMint = {
  txSignatures: string[]
  mintedNftMints: string[]
}

/**
 * After sendAndConfirm throws, the mint may still have landed (common on mobile wallets).
 * We know the planned mint pubkeys ahead of time — verify them on-chain and recover the tx sig.
 */
export async function recoverCandyMachineMintFromPlannedSigners(params: {
  rpcUrl: string
  walletB58: string
  candyMachineB58: string
  nftMints: Signer[]
  lastError?: unknown
}): Promise<RecoveredCandyMachineMint | null> {
  const planned = params.nftMints.map((m) => String(m.publicKey))
  let mintedNftMints = await detectPlannedMintAccounts(params.rpcUrl, planned, { attempts: 5, delayMs: 500 })
  const sigFromError = extractTxSignatureFromUnknownError(params.lastError)

  let txSignature =
    sigFromError ??
    (mintedNftMints.length > 0
      ? await findRecentCandyMachineMintSignature(
          params.rpcUrl,
          params.walletB58,
          params.candyMachineB58,
          mintedNftMints
        )
      : null)

  if (mintedNftMints.length === 0 && !txSignature) {
    mintedNftMints = await detectPlannedMintAccounts(params.rpcUrl, planned, {
      attempts: 4,
      delayMs: 600,
    })
  }

  if (mintedNftMints.length === 0 && !txSignature) return null

  if (!txSignature && mintedNftMints.length > 0) {
    txSignature = await findRecentCandyMachineMintSignature(
      params.rpcUrl,
      params.walletB58,
      params.candyMachineB58,
      mintedNftMints
    )
  }

  if (txSignature && mintedNftMints.length === 0) {
    mintedNftMints = await detectPlannedMintAccounts(params.rpcUrl, planned, {
      attempts: 4,
      delayMs: 600,
    })
  }

  if (mintedNftMints.length === 0 && !txSignature) return null

  return {
    txSignatures: txSignature ? [txSignature] : [],
    mintedNftMints,
  }
}

/** Try planned-mint polling first, then scan recent wallet history (Phantom / Solflare). */
export async function recoverCandyMachineMint(params: {
  rpcUrl: string
  walletB58: string
  candyMachineB58: string
  nftMints?: Signer[]
  lastError?: unknown
}): Promise<RecoveredCandyMachineMint | null> {
  if (params.nftMints?.length) {
    const fromPlanned = await recoverCandyMachineMintFromPlannedSigners({
      rpcUrl: params.rpcUrl,
      walletB58: params.walletB58,
      candyMachineB58: params.candyMachineB58,
      nftMints: params.nftMints,
      lastError: params.lastError,
    })
    if (fromPlanned && (fromPlanned.mintedNftMints.length > 0 || fromPlanned.txSignatures.length > 0)) {
      return fromPlanned
    }
  }

  return recoverRecentCandyMachineMintForWallet({
    rpcUrl: params.rpcUrl,
    walletB58: params.walletB58,
    candyMachineB58: params.candyMachineB58,
  })
}
