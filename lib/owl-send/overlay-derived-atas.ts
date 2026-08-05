/**
 * Complete NFT lock overlay via derived ATAs (not getParsedTokenAccountsByOwner).
 *
 * Large wallets truncate owner-scan RPCs, which left Gen2s as tokenAccount=mint and
 * wiped real freezes — OwlSend then let nested/mint-locked Gen2s into batches.
 */
import { Connection, PublicKey } from '@solana/web3.js'
import {
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

const ACCOUNT_STATE_FROZEN = 2
const BATCH = 100

function decodeLock(data: Buffer | Uint8Array): { frozen: boolean; delegated: boolean; amount: string } | null {
  if (!data || data.length < AccountLayout.span) return null
  try {
    const decoded = AccountLayout.decode(data)
    return {
      frozen: Number(decoded.state) === ACCOUNT_STATE_FROZEN,
      delegated: Boolean(decoded.delegateOption && decoded.delegate),
      amount: decoded.amount.toString(),
    }
  } catch {
    return null
  }
}

function classicAta(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
}

function t22Ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
}

/**
 * For each mint, read the classic SPL ATA (and Token-2022 ATA if classic missing).
 * Returns one WalletNft lock row per mint that holds amount ≥ 1.
 */
export async function fetchNftLockOverlayByDerivedAtas(params: {
  connection: Connection
  owner: PublicKey
  mints: string[]
}): Promise<WalletNft[]> {
  const { connection, owner } = params
  const unique = [...new Set(params.mints.map((m) => m.trim()).filter(Boolean))]
  if (unique.length < 1) return []

  type Pending = {
    mint: string
    classic: PublicKey
    t22: PublicKey
  }
  const pending: Pending[] = []
  for (const mint of unique) {
    try {
      const mintPk = new PublicKey(mint)
      pending.push({ mint, classic: classicAta(mintPk, owner), t22: t22Ata(mintPk, owner) })
    } catch {
      /* skip invalid */
    }
  }

  const out: WalletNft[] = []
  const found = new Set<string>()

  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH)
    const infos = await connection.getMultipleAccountsInfo(
      chunk.map((c) => c.classic),
      'processed'
    )
    const needT22: Pending[] = []
    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j]!
      const info = infos[j]
      if (info && info.owner.equals(TOKEN_PROGRAM_ID)) {
        const lock = decodeLock(info.data)
        if (lock && lock.amount !== '0') {
          out.push({
            mint: row.mint,
            tokenAccount: row.classic.toBase58(),
            amount: lock.amount,
            decimals: 0,
            metadataUri: null,
            name: null,
            image: null,
            collectionName: null,
            frozen: lock.frozen,
            delegated: lock.delegated,
          })
          found.add(row.mint)
          continue
        }
      }
      needT22.push(row)
    }

    if (needT22.length > 0) {
      const t22Infos = await connection.getMultipleAccountsInfo(
        needT22.map((c) => c.t22),
        'processed'
      )
      for (let j = 0; j < needT22.length; j++) {
        const row = needT22[j]!
        const info = t22Infos[j]
        if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) continue
        const lock = decodeLock(info.data)
        if (!lock || lock.amount === '0') continue
        out.push({
          mint: row.mint,
          tokenAccount: row.t22.toBase58(),
          amount: lock.amount,
          decimals: 0,
          metadataUri: null,
          name: null,
          image: null,
          collectionName: null,
          frozen: lock.frozen,
          delegated: lock.delegated,
        })
        found.add(row.mint)
      }
    }
  }

  return out
}

/**
 * JSON-RPC variant for API routes that already have an RPC URL (no Connection required).
 */
export async function fetchNftLockOverlayByDerivedAtasRpc(params: {
  rpcUrl: string
  owner: string
  mints: string[]
}): Promise<WalletNft[]> {
  const owner = new PublicKey(params.owner.trim())
  const unique = [...new Set(params.mints.map((m) => m.trim()).filter(Boolean))]
  if (unique.length < 1) return []

  type Pending = { mint: string; classic: PublicKey; t22: PublicKey }
  const pending: Pending[] = []
  for (const mint of unique) {
    try {
      const mintPk = new PublicKey(mint)
      pending.push({ mint, classic: classicAta(mintPk, owner), t22: t22Ata(mintPk, owner) })
    } catch {
      /* skip */
    }
  }

  async function multiGet(keys: PublicKey[]): Promise<Array<{ owner: string; data: Buffer } | null>> {
    const res = await fetch(params.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'derived-ata-overlay',
        method: 'getMultipleAccounts',
        params: [keys.map((k) => k.toBase58()), { encoding: 'base64', commitment: 'processed' }],
      }),
      cache: 'no-store',
    })
    if (!res.ok) return keys.map(() => null)
    const json = (await res.json().catch(() => null)) as {
      result?: { value?: Array<{ owner?: string; data?: [string, string] } | null> }
    }
    const value = json?.result?.value
    if (!Array.isArray(value)) return keys.map(() => null)
    return value.map((v) => {
      if (!v?.owner || !v.data?.[0]) return null
      try {
        return { owner: v.owner, data: Buffer.from(v.data[0], 'base64') }
      } catch {
        return null
      }
    })
  }

  const out: WalletNft[] = []
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH)
    const infos = await multiGet(chunk.map((c) => c.classic))
    const needT22: Pending[] = []
    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j]!
      const info = infos[j]
      if (info && info.owner === TOKEN_PROGRAM_ID.toBase58()) {
        const lock = decodeLock(info.data)
        if (lock && lock.amount !== '0') {
          out.push({
            mint: row.mint,
            tokenAccount: row.classic.toBase58(),
            amount: lock.amount,
            decimals: 0,
            metadataUri: null,
            name: null,
            image: null,
            collectionName: null,
            frozen: lock.frozen,
            delegated: lock.delegated,
          })
          continue
        }
      }
      needT22.push(row)
    }
    if (needT22.length > 0) {
      const t22Infos = await multiGet(needT22.map((c) => c.t22))
      for (let j = 0; j < needT22.length; j++) {
        const row = needT22[j]!
        const info = t22Infos[j]
        if (!info || info.owner !== TOKEN_2022_PROGRAM_ID.toBase58()) continue
        const lock = decodeLock(info.data)
        if (!lock || lock.amount === '0') continue
        out.push({
          mint: row.mint,
          tokenAccount: row.t22.toBase58(),
          amount: lock.amount,
          decimals: 0,
          metadataUri: null,
          name: null,
          image: null,
          collectionName: null,
          frozen: lock.frozen,
          delegated: lock.delegated,
        })
      }
    }
  }
  return out
}
