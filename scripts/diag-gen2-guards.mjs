// One-off: read live Gen2 candy guard caps + CM itemsRedeemed, and decode a tx's mintV2 group.
// node scripts/diag-gen2-guards.mjs <RPC_URL> <CM_ID> [<SIG>]
import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine, safeFetchCandyGuard } from '@metaplex-foundation/mpl-candy-machine'
import { isSome, publicKey } from '@metaplex-foundation/umi'

const rpc = process.argv[2]
const cmId = process.argv[3]
const sig = process.argv[4]

const CANDY_GUARD_PROGRAM_ID = 'Guard1JwRhJkVH6XZhzoYxeBVQe872VH6QggF4BWmS9g'
const MINT_V2_DISC = [120, 121, 23, 146, 173, 110, 199, 205]

const umi = createUmi(rpc, { commitment: 'confirmed' }).use(mplCandyMachine())
const cm = await fetchCandyMachine(umi, publicKey(cmId))
const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)

console.log(`CM ${cmId}`)
console.log(`  itemsRedeemed = ${Number(cm.itemsRedeemed)} / itemsLoaded = ${Number(cm.itemsLoaded)}`)
console.log(`  guard authority = ${guard?.authority}`)
console.log('  groups (redeemedAmount.maximum):')
for (const g of guard?.groups ?? []) {
  const cap = isSome(g.guards.redeemedAmount) ? String(g.guards.redeemedAmount.value.maximum) : 'none'
  const broken = cap !== 'none' && Number(cap) < Number(cm.itemsRedeemed)
  console.log(`    [${g.label}] redeemedAmount.maximum=${cap}${broken ? '  <-- BROKEN (cap < itemsRedeemed)' : ''}`)
}

if (sig) {
  async function rpcCall(method, params) {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const j = await res.json()
    if (j.error) throw new Error(JSON.stringify(j.error))
    return j.result
  }
  const tx = await rpcCall('getTransaction', [sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed', encoding: 'json' }])
  const msg = tx?.transaction?.message
  const keys = msg?.accountKeys ?? []
  let groupLabel = null
  for (const ix of msg?.instructions ?? []) {
    const pid = keys[ix.programIdIndex]
    if (pid !== CANDY_GUARD_PROGRAM_ID) continue
    const bytes = bs58.decode(ix.data)
    const isMint = MINT_V2_DISC.every((b, i) => bytes[i] === b)
    if (!isMint) continue
    // group is the LAST Some(string) field: 0x01 + u32le(len) + utf8
    if (bytes[bytes.length] === undefined) {
      // find Some flag near the tail
    }
    // Decode tail: last byte block — find 0x01 marker followed by len
    for (let p = bytes.length - 1; p >= 8; p--) {
      if (bytes[p - 5] === 1) {
        const len = new DataView(bytes.buffer, bytes.byteOffset + p - 4, 4).getUint32(0, true)
        if (p - 5 + 5 + len === bytes.length) {
          groupLabel = new TextDecoder().decode(bytes.slice(p, p + len))
          break
        }
      }
    }
  }
  console.log(`\n  tx ${sig}`)
  console.log(`    mintV2 group label = ${groupLabel ?? 'NOT DECODED'}`)
}
