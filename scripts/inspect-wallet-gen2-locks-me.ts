/**
 * Fetch Gen2 holdings via Magic Eden + on-chain freeze/delegate via public RPC.
 * Usage: npx tsx scripts/inspect-wallet-gen2-locks-me.ts <wallet>
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { AccountLayout } from '@solana/spl-token'

const ACCOUNT_STATE_FROZEN = 2

async function fetchMeTokens(wallet: string) {
  const out: Array<{ mint: string; name: string; collection: string | null }> = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const url = `https://api-mainnet.magiceden.dev/v2/wallets/${wallet}/tokens?offset=${offset}&limit=100&listStatus=both`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`ME ${res.status}`)
    const batch = (await res.json()) as Array<{
      mintAddress?: string
      name?: string
      collection?: string
      collectionName?: string
    }>
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const t of batch) {
      if (!t.mintAddress) continue
      out.push({
        mint: t.mintAddress,
        name: t.name || t.mintAddress.slice(0, 8),
        collection: t.collection || t.collectionName || null,
      })
    }
    if (batch.length < 100) break
    await new Promise((r) => setTimeout(r, 200))
  }
  return out
}

async function main() {
  const wallet = (process.argv[2] || '').trim()
  if (!wallet) throw new Error('wallet required')
  const owner = new PublicKey(wallet)

  const rpc =
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    'https://api.mainnet-beta.solana.com'
  const conn = new Connection(rpc, 'confirmed')

  console.log('Fetching ME tokens…')
  const all = await fetchMeTokens(wallet)
  const gen2 = all.filter(
    (t) =>
      (t.collection || '').toLowerCase().includes('owltopia_gen2') ||
      (t.collection || '').toLowerCase().includes('owltopia g2') ||
      /^Owltopia G2 #/i.test(t.name)
  )
  console.log(JSON.stringify({ totalMe: all.length, gen2: gen2.length, rpcHost: new URL(rpc).host }, null, 2))

  // Resolve ATAs and batch getMultipleAccountsInfo
  const atas = gen2.map((t) => {
    const mint = new PublicKey(t.mint)
    const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    return { ...t, ata }
  })

  const frozen: typeof atas = []
  const delegated: typeof atas = []
  const thawedDelegated: Array<(typeof atas)[0] & { delegate: string }> = []
  const thawedClean: typeof atas = []
  const missing: typeof atas = []
  const delegates = new Map<string, number>()

  for (let i = 0; i < atas.length; i += 100) {
    const chunk = atas.slice(i, i + 100)
    const infos = await conn.getMultipleAccountsInfo(
      chunk.map((c) => c.ata),
      'confirmed'
    )
    for (let j = 0; j < chunk.length; j++) {
      const info = infos[j]
      const row = chunk[j]!
      if (!info || info.data.length < AccountLayout.span) {
        missing.push(row)
        continue
      }
      const decoded = AccountLayout.decode(info.data)
      const isFrozen = Number(decoded.state) === ACCOUNT_STATE_FROZEN
      const hasDel = Boolean(decoded.delegateOption && decoded.delegate)
      const del = hasDel ? new PublicKey(decoded.delegate).toBase58() : null
      if (isFrozen) frozen.push(row)
      if (hasDel) {
        delegated.push(row)
        delegates.set(del!, (delegates.get(del!) || 0) + 1)
      }
      if (isFrozen === false && hasDel && del) thawedDelegated.push({ ...row, delegate: del })
      if (!isFrozen && !hasDel) thawedClean.push(row)
    }
    await new Promise((r) => setTimeout(r, 350))
  }

  console.log(
    'ONCHAIN_SUMMARY',
    JSON.stringify(
      {
        gen2Checked: atas.length,
        frozen: frozen.length,
        delegated: delegated.length,
        thawedButDelegated: thawedDelegated.length,
        thawedClean: thawedClean.length,
        missingAta: missing.length,
        topDelegates: [...delegates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      },
      null,
      2
    )
  )
  console.log('FROZEN_SAMPLE', JSON.stringify(frozen.slice(0, 15).map((r) => ({ name: r.name, mint: r.mint })), null, 2))
  console.log(
    'THAWED_DELEGATED_SAMPLE',
    JSON.stringify(thawedDelegated.slice(0, 15).map((r) => ({ name: r.name, mint: r.mint, delegate: r.delegate })), null, 2)
  )
  console.log('MISSING_SAMPLE', JSON.stringify(missing.slice(0, 10).map((r) => ({ name: r.name, mint: r.mint })), null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
