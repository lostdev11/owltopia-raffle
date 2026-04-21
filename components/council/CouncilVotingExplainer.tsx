/**
 * Short explainer for Owl Council voting (weights and escrow tip).
 */
export function CouncilVotingExplainer({ escrowVotingEnabled = false }: { escrowVotingEnabled?: boolean }) {
  return (
    <aside
      className="mb-8 sm:mb-10 rounded-xl border border-border/70 bg-muted/25 px-4 py-4 sm:px-5 sm:py-4 text-sm text-muted-foreground leading-relaxed"
      aria-label="How Owl Council voting works"
    >
      <p>
        <span className="text-foreground font-medium">Voting here is in-app and gas-free:</span> each connected wallet
        casts yes, no, or abstain, and totals weight your{' '}
        {escrowVotingEnabled ? (
          <>
            <span className="text-foreground font-medium">OWL held in the Council escrow</span> (send OWL via the escrow
            panel on this page).
          </>
        ) : (
          <>
            <span className="text-foreground font-medium">OWL balance</span>.
          </>
        )}
      </p>
      {escrowVotingEnabled ? (
        <p className="mt-3">
          <span className="text-foreground font-medium">Escrow:</span> OWL stays in the Council pool until you
          withdraw it; you can leave it there to vote on later proposals without depositing again.
        </p>
      ) : null}
      <p className="mt-3">
        <span className="text-foreground font-medium">Tip:</span> skim{' '}
        <span className="text-foreground">Past decisions</span> below to see how successful proposals were framed.
      </p>
    </aside>
  )
}
