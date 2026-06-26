// Standalone tx inspector (no deps): node scripts/diag-tx.mjs <RPC_URL> <SIG> [<SIG>...]
const rpc = process.argv[2]
const sigs = process.argv.slice(3)

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

for (const sig of sigs) {
  console.log(`\n=================== ${sig} ===================`)
  const tx = await rpcCall('getTransaction', [sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }])
  if (!tx) {
    console.log('  NOT FOUND on this RPC')
    continue
  }
  console.log(`  slot=${tx.slot} blockTime=${tx.blockTime}`)
  console.log(`  err=${JSON.stringify(tx.meta?.err)}  fee=${tx.meta?.fee}`)
  const pre = tx.meta?.preTokenBalances ?? []
  const post = tx.meta?.postTokenBalances ?? []
  console.log(`  preTokenBalances=${pre.length} postTokenBalances=${post.length}`)
  for (const b of post) {
    console.log(`    POST mint=${b.mint} owner=${b.owner} amount=${b.uiTokenAmount.amount}`)
  }
  console.log('  logs:')
  for (const l of tx.meta?.logMessages ?? []) console.log(`    ${l}`)
}
