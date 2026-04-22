import type { Metadata } from 'next'
import { CouncilCreateProposalForm } from '@/components/council/CouncilCreateProposalForm'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { PLATFORM_NAME } from '@/lib/site-config'
import { OWL_TICKER } from '@/lib/council/owl-ticker'

export const metadata: Metadata = {
  title: `Create proposal | Owl Council | ${PLATFORM_NAME}`,
  description: `${OWL_TICKER} holders can submit governance proposals for Owl Council.`,
}

export default function CouncilCreatePage() {
  return (
    <div className="min-h-[50vh]">
      <div className="border-b border-border/60 bg-card/20">
        <div className="container mx-auto px-3 sm:px-4 py-6 max-w-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl tracking-wide text-foreground">New proposal</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {OWL_TICKER} holders (10+ {OWL_TICKER}) can publish proposals for the community.
            </p>
          </div>
          <WalletConnectButton />
        </div>
      </div>
      <CouncilCreateProposalForm />
    </div>
  )
}
