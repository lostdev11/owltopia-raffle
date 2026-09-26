import assert from 'node:assert/strict'
import { PackOpenRetryableError, isPackOpenRetryableError } from '../lib/packs/pack-open-errors'
import { isTransientSolanaRpcError, withSolanaRpcRetry } from '../lib/solana/rpc-retry'

async function main() {
  const err429 = new Error('429 Too Many Requests: {"error":"too many requests"}')
  assert.equal(isTransientSolanaRpcError(err429), true)

  let attempts = 0
  const result = await withSolanaRpcRetry(
    async () => {
      attempts++
      if (attempts < 3) throw err429
      return 'ok'
    },
    { retries: 4, baseDelayMs: 10, jitter: true }
  )
  assert.equal(result, 'ok')
  assert.equal(attempts, 3)

  const retryable = new PackOpenRetryableError('rpc')
  assert.equal(isPackOpenRetryableError(retryable), true)

  console.log(JSON.stringify({ ok: true, tests: 'packs-rpc-hardening' }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
