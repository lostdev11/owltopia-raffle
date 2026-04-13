'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import { Landmark, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { getGovernanceProgramId, MAX_VOTING_SECS, MIN_VOTING_SECS } from '@/lib/governance/config'
import { governanceAccountCoder } from '@/lib/governance/coders'
import {
  buildCastVoteInstruction,
  buildCreateProposalInstruction,
  buildStakeInstruction,
  buildUnstakeInstruction,
} from '@/lib/governance/instructions'
import { globalConfigPda, proposalPda, userStakePda } from '@/lib/governance/pdas'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { PLATFORM_NAME } from '@/lib/site-config'

type GlobalConfigDecoded = {
  authority: PublicKey
  owl_mint: PublicKey
  vault: PublicKey
  bump: number
  proposal_count: BN
  min_voting_secs: BN
  max_voting_secs: BN
  min_stake_to_propose: BN
  vote_stake_weight_bps: BN
}

type UserStakeDecoded = {
  bump: number
  owner: PublicKey
  amount: BN
}

type ProposalDecoded = {
  id: BN
  proposer: PublicKey
  voting_start: BN
  voting_end: BN
  title: string
  yes_weight: BN
  no_weight: BN
  bump: number
}

type ProposalRow = {
  id: bigint
  pubkey: PublicKey
  data: ProposalDecoded
}

function parseUiAmountToRaw(s: string, decimals: number): bigint {
  const trimmed = s.trim()
  if (!trimmed) throw new Error('Enter an amount')
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('Invalid amount')
  const [whole, frac = ''] = trimmed.split('.')
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  const w = BigInt(whole) * BigInt(10 ** decimals)
  const f = fracPadded ? BigInt(fracPadded) : 0n
  const out = w + f
  if (out <= 0n) throw new Error('Amount must be greater than zero')
  return out
}

function formatRawOwl(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const whole = raw / base
  const frac = raw % base
  if (decimals === 0) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

function solscanTxUrl(sig: string): string {
  const dev = /devnet/i.test(resolvePublicSolanaRpcUrl())
  return `https://solscan.io/tx/${encodeURIComponent(sig)}${dev ? '?cluster=devnet' : ''}`
}

export function OwlCouncilClient() {
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const sendTransaction = useSendTransactionForWallet()

  const programId = useMemo(() => getGovernanceProgramId(), [])
  const owlInfo = useMemo(() => getTokenInfo('OWL'), [])
  const owlMintPk = useMemo(
    () => (owlInfo.mintAddress ? new PublicKey(owlInfo.mintAddress) : null),
    [owlInfo.mintAddress]
  )

  const [loading, setLoading] = useState(true)
  const [global, setGlobal] = useState<GlobalConfigDecoded | null>(null)
  const [userStake, setUserStake] = useState<UserStakeDecoded | null>(null)
  const [proposals, setProposals] = useState<ProposalRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lastSig, setLastSig] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [stakeAmount, setStakeAmount] = useState('')
  const [unstakeAmount, setUnstakeAmount] = useState('')
  const [proposalTitle, setProposalTitle] = useState('')
  const [proposalHours, setProposalHours] = useState('72')
  const [voteProposalId, setVoteProposalId] = useState('')
  const [voteSide, setVoteSide] = useState<'0' | '1'>('0')

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [globalPk] = globalConfigPda(programId)
      const gAcc = await connection.getAccountInfo(globalPk, 'confirmed')
      if (!gAcc) {
        setGlobal(null)
        setUserStake(null)
        setProposals([])
        return
      }
      const decoded = governanceAccountCoder.decode(
        'GlobalConfig',
        gAcc.data
      ) as GlobalConfigDecoded
      setGlobal(decoded)

      if (owlMintPk && !decoded.owl_mint.equals(owlMintPk)) {
        setLoadError(
          `On-chain OWL mint (${decoded.owl_mint.toBase58()}) does not match this site’s NEXT_PUBLIC_OWL_MINT_ADDRESS.`
        )
      }

      const countBn = decoded.proposal_count
      const count = countBn.bitLength() > 53 ? 0 : countBn.toNumber()
      const cap = Math.min(count, 40)
      const rows: ProposalRow[] = []
      const start = Math.max(0, count - cap)
      for (let i = start; i < count; i++) {
        const id = BigInt(i)
        const [ppk] = proposalPda(globalPk, id, programId)
        const pAcc = await connection.getAccountInfo(ppk, 'confirmed')
        if (!pAcc?.data) continue
        try {
          const p = governanceAccountCoder.decode('Proposal', pAcc.data) as ProposalDecoded
          rows.push({ id, pubkey: ppk, data: p })
        } catch {
          continue
        }
      }
      rows.reverse()
      setProposals(rows)

      if (publicKey) {
        const [stakePk] = userStakePda(publicKey, programId)
        const sAcc = await connection.getAccountInfo(stakePk, 'confirmed')
        if (sAcc?.data) {
          setUserStake(governanceAccountCoder.decode('UserStake', sAcc.data) as UserStakeDecoded)
        } else {
          setUserStake(null)
        }
      } else {
        setUserStake(null)
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load governance state')
      setGlobal(null)
    } finally {
      setLoading(false)
    }
  }, [connection, programId, publicKey, owlMintPk])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const owlDecimals = owlInfo.decimals
  const stakedRaw = userStake ? BigInt(userStake.amount.toString()) : 0n
  const stakedUi = formatRawOwl(stakedRaw, owlDecimals)

  const sendIx = async (label: string, addIx: (tx: Transaction) => void) => {
    if (!publicKey) return
    setActionError(null)
    setBusy(label)
    setLastSig(null)
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: publicKey,
      })
      addIx(transaction)
      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      )
      setLastSig(signature)
      await refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Transaction failed')
    } finally {
      setBusy(null)
    }
  }

  const onStake = async () => {
    if (!publicKey || !owlMintPk) return
    const raw = parseUiAmountToRaw(stakeAmount, owlDecimals)
    const ata = await getAssociatedTokenAddress(owlMintPk, publicKey)
    await sendIx('staking', (tx) => {
      tx.add(
        buildStakeInstruction({
          programId,
          user: publicKey,
          owlMint: owlMintPk,
          userOwlAta: ata,
          amount: new BN(raw.toString()),
        })
      )
    })
    setStakeAmount('')
  }

  const onUnstake = async () => {
    if (!publicKey || !owlMintPk) return
    const raw = parseUiAmountToRaw(unstakeAmount, owlDecimals)
    const ata = await getAssociatedTokenAddress(owlMintPk, publicKey)
    await sendIx('unstaking', (tx) => {
      tx.add(
        buildUnstakeInstruction({
          programId,
          user: publicKey,
          owlMint: owlMintPk,
          userOwlAta: ata,
          amount: new BN(raw.toString()),
        })
      )
    })
    setUnstakeAmount('')
  }

  const onCreateProposal = async () => {
    if (!publicKey || !owlMintPk || !global) return
    const title = proposalTitle.trim()
    if (!title) {
      setActionError('Enter a proposal title')
      return
    }
    if (title.length > 200) {
      setActionError('Title must be at most 200 characters')
      return
    }
    const hours = Number(proposalHours)
    if (!Number.isFinite(hours) || hours < 48 || hours > 168) {
      setActionError('Voting duration must be between 48 and 168 hours (7 days).')
      return
    }
    const secs = Math.floor(hours * 3600)
    if (secs < MIN_VOTING_SECS || secs > MAX_VOTING_SECS) {
      setActionError('Duration out of allowed range.')
      return
    }
    const proposalId = BigInt(global.proposal_count.toString())
    await sendIx('create proposal', (tx) => {
      tx.add(
        buildCreateProposalInstruction({
          programId,
          proposer: publicKey,
          owlMint: owlMintPk,
          proposalId,
          title,
          votingDurationSecs: new BN(secs),
        })
      )
    })
    setProposalTitle('')
  }

  const onCastVote = async () => {
    if (!publicKey || !owlMintPk) return
    const idTrim = voteProposalId.trim()
    if (!/^\d+$/.test(idTrim)) {
      setActionError('Proposal id must be a non-negative integer.')
      return
    }
    const id = BigInt(idTrim)
    const [globalPk] = globalConfigPda(programId)
    const [ppk] = proposalPda(globalPk, id, programId)
    const side = (voteSide === '0' ? 0 : 1) as 0 | 1
    await sendIx('vote', (tx) => {
      tx.add(
        buildCastVoteInstruction({
          programId,
          voter: publicKey,
          owlMint: owlMintPk,
          proposal: ppk,
          side,
        })
      )
    })
  }

  if (!isOwlEnabled() || !owlMintPk) {
    return (
      <div className="container mx-auto px-3 sm:px-4 py-8 max-w-xl">
        <Card className="border-green-500/20 bg-black/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Landmark className="h-5 w-5 text-primary" />
              Owl Council
            </CardTitle>
            <CardDescription>
              Set <code className="text-xs">NEXT_PUBLIC_OWL_MINT_ADDRESS</code> to use OWL governance on this
              deployment.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 max-w-2xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Landmark className="h-7 w-7 text-primary shrink-0" />
            Owl Council
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Stake OWL, open proposals, and vote on-chain. {PLATFORM_NAME} uses your usual wallet connection
            (works on mobile wallets).
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Program:{' '}
            <code className="break-all">{programId.toBase58()}</code> — optional override{' '}
            <code className="whitespace-nowrap">NEXT_PUBLIC_GOVERNANCE_PROGRAM_ID</code>.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch-manipulation min-h-[44px] shrink-0 self-start"
          onClick={() => void refresh()}
          disabled={busy !== null}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {!connected && (
        <Card className="border-green-500/20 bg-black/40">
          <CardHeader>
            <CardTitle className="text-base">Connect wallet</CardTitle>
            <CardDescription>Stake and vote with the wallet that holds your OWL.</CardDescription>
          </CardHeader>
          <CardContent>
            <WalletConnectButton />
          </CardContent>
        </Card>
      )}

      {loading && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
          Loading governance…
        </p>
      )}

      {loadError && (
        <p className="text-sm text-destructive border border-destructive/40 rounded-md p-3">{loadError}</p>
      )}

      {!loading && global === null && (
        <Card className="border-amber-500/30 bg-black/40">
          <CardHeader>
            <CardTitle className="text-base text-amber-200">Not initialized</CardTitle>
            <CardDescription>
              No governance config account was found for this program on the RPC cluster you are using (
              {/devnet/i.test(resolvePublicSolanaRpcUrl()) ? 'devnet' : 'mainnet'}-style). Deploy the Anchor program
              and call <code className="text-xs">initialize</code> with the OWL mint before using this page.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!loading && global && (
        <>
          <Card className="border-green-500/20 bg-black/40">
            <CardHeader>
              <CardTitle className="text-base">Your stake</CardTitle>
              <CardDescription>
                Staked in the program vault (voting weight uses this balance at vote time). Min stake to propose:{' '}
                {formatRawOwl(BigInt(global.min_stake_to_propose.toString()), owlDecimals)} OWL. Vote weight
                multiplier: {(Number(global.vote_stake_weight_bps.toString()) / 10000).toFixed(2)}× raw stake.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-lg font-mono text-green-100">{stakedUi} OWL</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="stake-amt">
                    Stake amount
                  </label>
                  <Input
                    id="stake-amt"
                    inputMode="decimal"
                    className="touch-manipulation min-h-[44px]"
                    placeholder={`0 — ${owlDecimals} decimals`}
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    disabled={!connected || busy !== null}
                  />
                  <Button
                    type="button"
                    className="w-full touch-manipulation min-h-[44px]"
                    onClick={() => void onStake()}
                    disabled={!connected || busy !== null}
                  >
                    {busy === 'staking' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" aria-hidden />
                        Staking…
                      </>
                    ) : (
                      'Stake OWL'
                    )}
                  </Button>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="unstake-amt">
                    Unstake amount
                  </label>
                  <Input
                    id="unstake-amt"
                    inputMode="decimal"
                    className="touch-manipulation min-h-[44px]"
                    placeholder={`0 — ${owlDecimals} decimals`}
                    value={unstakeAmount}
                    onChange={(e) => setUnstakeAmount(e.target.value)}
                    disabled={!connected || busy !== null}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full touch-manipulation min-h-[44px]"
                    onClick={() => void onUnstake()}
                    disabled={!connected || busy !== null}
                  >
                    {busy === 'unstaking' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" aria-hidden />
                        Unstaking…
                      </>
                    ) : (
                      'Unstake'
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-green-500/20 bg-black/40">
            <CardHeader>
              <CardTitle className="text-base">Create proposal</CardTitle>
              <CardDescription>
                Voting period: 48 hours minimum, 7 days maximum. Title is stored on-chain (max 200 characters).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="prop-title">
                  Title
                </label>
                <Input
                  id="prop-title"
                  className="touch-manipulation min-h-[44px]"
                  value={proposalTitle}
                  onChange={(e) => setProposalTitle(e.target.value)}
                  maxLength={200}
                  disabled={!connected || busy !== null}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="prop-hours">
                  Voting duration (hours)
                </label>
                <select
                  id="prop-hours"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation"
                  value={proposalHours}
                  onChange={(e) => setProposalHours(e.target.value)}
                  disabled={!connected || busy !== null}
                >
                  {Array.from({ length: 168 - 48 + 1 }, (_, i) => 48 + i).map((h) => (
                    <option key={h} value={String(h)}>
                      {h} hours
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                className="w-full touch-manipulation min-h-[44px]"
                onClick={() => void onCreateProposal()}
                disabled={!connected || busy !== null}
              >
                {busy === 'create proposal' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" aria-hidden />
                    Submitting…
                  </>
                ) : (
                  'Submit proposal'
                )}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-green-500/20 bg-black/40">
            <CardHeader>
              <CardTitle className="text-base">Vote</CardTitle>
              <CardDescription>
                One vote per wallet per proposal. Weight = current staked OWL × multiplier. Choose proposal id
                (see list below).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="vote-id">
                  Proposal id
                </label>
                <Input
                  id="vote-id"
                  inputMode="numeric"
                  className="touch-manipulation min-h-[44px]"
                  placeholder="0"
                  value={voteProposalId}
                  onChange={(e) => setVoteProposalId(e.target.value)}
                  disabled={!connected || busy !== null}
                />
              </div>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-sm touch-manipulation min-h-[44px]">
                  <input
                    type="radio"
                    name="vote-side"
                    checked={voteSide === '0'}
                    onChange={() => setVoteSide('0')}
                    disabled={!connected || busy !== null}
                  />
                  Yes
                </label>
                <label className="flex items-center gap-2 text-sm touch-manipulation min-h-[44px]">
                  <input
                    type="radio"
                    name="vote-side"
                    checked={voteSide === '1'}
                    onChange={() => setVoteSide('1')}
                    disabled={!connected || busy !== null}
                  />
                  No
                </label>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full touch-manipulation min-h-[44px]"
                onClick={() => void onCastVote()}
                disabled={!connected || busy !== null}
              >
                {busy === 'vote' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" aria-hidden />
                    Voting…
                  </>
                ) : (
                  'Cast vote'
                )}
              </Button>
            </CardContent>
          </Card>

          {proposals.length > 0 && (
            <Card className="border-green-500/20 bg-black/40">
              <CardHeader>
                <CardTitle className="text-base">Recent proposals</CardTitle>
                <CardDescription>Loaded from your RPC (newest ids may be omitted if the list is long).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {proposals.map((p) => {
                  const start = Number(p.data.voting_start.toString()) * 1000
                  const end = Number(p.data.voting_end.toString()) * 1000
                  const now = Date.now()
                  const open = now >= start && now < end
                  return (
                    <div key={p.pubkey.toBase58()} className="border border-green-500/15 rounded-lg p-3 space-y-1">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="font-mono text-green-100">id {p.id.toString()}</span>
                        <span className={open ? 'text-primary' : 'text-muted-foreground'}>
                          {open ? 'Voting open' : now < start ? 'Not started' : 'Closed'}
                        </span>
                      </div>
                      <p className="font-medium break-words">{p.data.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Yes weight {p.data.yes_weight.toString()} — No weight {p.data.no_weight.toString()}
                      </p>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {actionError && (
        <p className="text-sm text-destructive border border-destructive/40 rounded-md p-3">{actionError}</p>
      )}

      {lastSig && (
        <p className="text-sm text-muted-foreground">
          Transaction:{' '}
          <Link
            href={solscanTxUrl(lastSig)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4 break-all"
          >
            {lastSig}
          </Link>
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Discord notifications for new proposals can be added later (listen for <code className="text-xs">ProposalCreated</code>{' '}
        in transaction logs).
      </p>
    </div>
  )
}
