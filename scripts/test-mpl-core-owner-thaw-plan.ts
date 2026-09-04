/**
 * Regression: MPL Core Owner freeze + admin recovery must DB-close (needsOwnerThaw),
 * while holder Leave still requires wallet thaw.
 * Run: npx tsx scripts/test-mpl-core-owner-thaw-plan.ts
 */
import assert from 'node:assert/strict'
import {
  planMplCoreNestThaw,
  type MplCoreFreezeDelegateInfo,
} from '../lib/solana/mpl-core-nest-lock'

const DELEGATE = 'NestFreezeDelegate1111111111111111111111111'

function fd(
  partial: Partial<MplCoreFreezeDelegateInfo> & Pick<MplCoreFreezeDelegateInfo, 'frozen'>
): MplCoreFreezeDelegateInfo {
  return {
    authorityType: null,
    authorityAddress: null,
    ...partial,
  }
}

{
  assert.deepEqual(
    planMplCoreNestThaw({
      freezeDelegate: null,
      nestingDelegateAddress: DELEGATE,
      adminRecoveryUnstake: true,
    }),
    { kind: 'noop' }
  )
  assert.deepEqual(
    planMplCoreNestThaw({
      freezeDelegate: fd({ frozen: false, authorityType: 'Owner' }),
      nestingDelegateAddress: DELEGATE,
      adminRecoveryUnstake: false,
    }),
    { kind: 'noop' }
  )
}

{
  // Confirmed root cause: Owner + admin recovery must NOT throw — DB-only close.
  assert.deepEqual(
    planMplCoreNestThaw({
      freezeDelegate: fd({ frozen: true, authorityType: 'Owner' }),
      nestingDelegateAddress: DELEGATE,
      adminRecoveryUnstake: true,
    }),
    { kind: 'admin_db_close_needs_owner_thaw' }
  )

  // Holder Leave still requires wallet-signed updatePlugin(frozen:false).
  assert.deepEqual(
    planMplCoreNestThaw({
      freezeDelegate: fd({ frozen: true, authorityType: 'Owner' }),
      nestingDelegateAddress: DELEGATE,
      adminRecoveryUnstake: false,
    }),
    { kind: 'require_wallet_owner_thaw' }
  )
}

{
  assert.deepEqual(
    planMplCoreNestThaw({
      freezeDelegate: fd({
        frozen: true,
        authorityType: 'Address',
        authorityAddress: DELEGATE,
      }),
      nestingDelegateAddress: DELEGATE,
      adminRecoveryUnstake: true,
    }),
    { kind: 'server_thaw_delegate' }
  )

  assert.deepEqual(
    planMplCoreNestThaw({
      freezeDelegate: fd({
        frozen: true,
        authorityType: 'Address',
        authorityAddress: 'OtherAuthority11111111111111111111111111',
      }),
      nestingDelegateAddress: DELEGATE,
      adminRecoveryUnstake: false,
    }),
    { kind: 'incompatible_authority' }
  )
}

console.log(JSON.stringify({ ok: true, mplCoreOwnerThawPlan: true }, null, 2))
