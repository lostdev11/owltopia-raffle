/**
 * Unit tests for OwlSend Core send RPC failure classification.
 * Run: npx tsx scripts/test-owl-send-core-send-rpc.ts
 */
import assert from 'node:assert/strict'
import { isOwlSendRpcNetworkError } from '../lib/owl-send/rpc-network-error'

const screenshot =
  'failed to get info about account Hs4xUCuBrd4DciG8FMcCZ2C7EWyPkTTLTsSjtsdyLmMo: TypeError: NetworkError when attempting to fetch resource.'

assert.equal(isOwlSendRpcNetworkError(screenshot), true)
assert.equal(isOwlSendRpcNetworkError('Failed to fetch'), true)
assert.equal(isOwlSendRpcNetworkError('Account is frozen'), false)
assert.equal(isOwlSendRpcNetworkError('token_metadata: Incorrect account owner'), false)

console.log('test-owl-send-core-send-rpc: ok')
