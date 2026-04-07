import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import {
  PLATFORM_NAME,
  OG_ALT,
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  getSiteBaseUrl,
  getDefaultOgImageAbsoluteUrl,
} from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const OG_IMAGE = getDefaultOgImageAbsoluteUrl()

export const metadata: Metadata = {
  title: `Terms of Service | ${PLATFORM_NAME}`,
  description: `Terms of Service for ${PLATFORM_NAME} platform.`,
  alternates: { canonical: `${SITE_URL}/terms` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/terms`,
    siteName: PLATFORM_NAME,
    title: `Terms of Service | ${PLATFORM_NAME}`,
    description: `Terms of Service for ${PLATFORM_NAME} platform.`,
    images: [{ url: OG_IMAGE, ...DEFAULT_OG_IMAGE_DIMS, alt: OG_ALT, type: DEFAULT_OG_IMAGE_TYPE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Terms of Service | ${PLATFORM_NAME}`,
    description: `Terms of Service for ${PLATFORM_NAME} platform.`,
    images: [{ url: OG_IMAGE, alt: OG_ALT, ...DEFAULT_OG_IMAGE_DIMS }],
  },
}

export default function TermsPage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <Link href="/raffles">
        <Button variant="ghost" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Raffles
        </Button>
      </Link>

      <div className="prose prose-invert max-w-none">
        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Last updated: April 6, 2026</p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
          <p className="mb-4">
            By accessing and using {PLATFORM_NAME} (&quot;the Platform&quot;), you accept and agree to be bound by the terms and provision of this agreement. 
            If you do not agree to abide by the above, please do not use this service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">2. Eligibility</h2>
          <p className="mb-4">
            You must be at least 18 years old to participate in raffles on this Platform. By using the Platform, you represent and warrant that:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>You are of legal age in your jurisdiction to participate in raffles</li>
            <li>You have the legal capacity to enter into binding agreements</li>
            <li>You are not prohibited from using the Platform by applicable laws</li>
            <li>You will comply with all applicable local, state, and federal laws and regulations</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">3. How the Raffle Works</h2>
          <p className="mb-4">
            {PLATFORM_NAME} facilitates raffles using Solana and our application services. In summary:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>Participants purchase entries using cryptocurrency (SOL, USDC, or OWL, as offered on each raffle)</li>
            <li>Each purchase corresponds to one or more tickets as shown at checkout</li>
            <li>Winners are selected by weighted random selection among confirmed entries (see Section 6)</li>
            <li>Payments and many prize movements are recorded on-chain where applicable</li>
            <li>Owl Vision is an informational trust score on each raffle; it does not guarantee outcomes or replace your own judgment</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">4. Wallet Responsibilities</h2>
          <p className="mb-4">
            You are solely responsible for:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>The security of your cryptocurrency wallet and private keys</li>
            <li>All transactions initiated from your wallet</li>
            <li>Ensuring you have sufficient funds to complete transactions</li>
            <li>Verifying transaction details before confirming</li>
            <li>Keeping your wallet software up to date</li>
          </ul>
          <p className="mb-4">
            The Platform is not responsible for any loss of funds due to wallet compromise, user error, or technical issues with your wallet.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">5. Entry and Payment</h2>
          <p className="mb-4">
            When you purchase raffle entries:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>Payments must be made in the cryptocurrency shown for that raffle (SOL, USDC, or OWL)</li>
            <li>For many raffles, ticket proceeds are sent to a platform <strong>funds escrow</strong> address and verified before your entry becomes confirmed; some raffles may use a different recipient address. You are responsible for reading the transaction you approve in your wallet</li>
            <li>The Platform charges a <strong>platform fee</strong> on ticket sales: <strong>3%</strong> when the raffle creator qualifies as an Owltopia (Owl) NFT holder, and <strong>6%</strong> otherwise. The fee is applied as part of the payment or settlement flow shown in the product</li>
            <li>Except where a failed minimum-threshold raffle allows refund claims from escrow (see Section 6), completed ticket purchases are final and not refundable</li>
            <li>Entry prices and limits are set by raffle creators and displayed before purchase</li>
            <li>You must ensure you have sufficient balance for network transaction fees</li>
            <li>Failed or abandoned transactions do not create confirmed entries</li>
            <li>Raffles may have a maximum ticket limit; once reached, no additional entries can be purchased</li>
            <li>Entries may be in &quot;pending&quot;, &quot;confirmed&quot;, or &quot;rejected&quot; status — only <strong>confirmed</strong> entries count toward minimum thresholds and winner selection</li>
            <li>If an entry is rejected due to verification failure or policy limits, you may not receive a refund unless these Terms or the Platform expressly provides a refund path for that situation</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">6. Prize Distribution</h2>
          <p className="mb-4">
            Winners and payouts follow these rules (in addition to anything stated on a specific raffle):
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>Selection uses <strong>weighted random selection</strong> among <strong>confirmed</strong> entries: each wallet&apos;s probability is proportional to its total confirmed ticket count for that raffle. The draw is performed by Platform software (not an on-chain verifiable randomness beacon)</li>
            <li>If <strong>no minimum ticket threshold</strong> is set, a winner may be selected after the scheduled end time if there is at least one confirmed entry and other eligibility checks pass</li>
            <li>If a <strong>minimum ticket threshold</strong> is set, a winner can be selected only after the raffle has ended and <strong>confirmed</strong> ticket sales meet or exceed that threshold. There is <strong>no</strong> separate mandatory multi-day waiting period after the minimum is met solely for that reason</li>
            <li>If the minimum is <strong>not</strong> met when the raffle ends, the Platform may <strong>extend the end time once</strong>, typically by the same duration as the raffle&apos;s original window (or by seven days if that duration cannot be determined). If the minimum is still not met after that extension, the raffle may be marked failed; participants on <strong>funds-escrow</strong> raffles may be able to <strong>claim refunds</strong> of their ticket payments through the Platform, and escrowed NFT prizes may be returned to the creator when operationally possible</li>
            <li>For <strong>NFT</strong> prizes, the prize is expected to be held in <strong>prize escrow</strong> before a draw. The winning wallet may need to <strong>claim</strong> the NFT through the Platform after the draw</li>
            <li>For raffles that route ticket proceeds through funds escrow, the creator&apos;s net share after the platform fee may be available to <strong>claim</strong> after settlement, as shown in the product</li>
            <li>Winners are reflected on the Platform (e.g. raffle detail, dashboard). You are responsible for monitoring your wallet and the Platform for claim steps</li>
            <li>The Platform is not responsible for assets after successful on-chain delivery to the wallet you used, or for user error (wrong wallet, failed claim, etc.)</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">7. Blockchain and Cryptocurrency Disclaimers</h2>
          <p className="mb-4">
            You acknowledge and understand that:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>Cryptocurrency transactions are irreversible</li>
            <li>Blockchain networks may experience delays or congestion</li>
            <li>Transaction fees (gas) are required and vary based on network conditions</li>
            <li>Cryptocurrency values can be highly volatile</li>
            <li>The Platform does not control the underlying blockchain networks</li>
            <li>Smart contracts and blockchain technology may contain bugs or vulnerabilities</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">8. Prohibited Activities</h2>
          <p className="mb-4">You agree not to:</p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>Use the Platform for any illegal purposes</li>
            <li>Attempt to manipulate or exploit the raffle system</li>
            <li>Use automated tools or bots to purchase entries</li>
            <li>Interfere with or disrupt the Platform's operation</li>
            <li>Impersonate any person or entity</li>
            <li>Attempt to gain unauthorized access to the Platform</li>
            <li>Violate any applicable laws or regulations</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">9. Limitation of Liability</h2>
          <p className="mb-4">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE PLATFORM AND ITS OPERATORS SHALL NOT BE LIABLE FOR:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>Any indirect, incidental, special, or consequential damages</li>
            <li>Loss of profits, revenue, data, or cryptocurrency</li>
            <li>Errors or delays in blockchain transactions</li>
            <li>Wallet security breaches or compromised accounts</li>
            <li>Technical failures or interruptions</li>
            <li>Acts or omissions of third parties (including blockchain networks)</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">10. No Warranties</h2>
          <p className="mb-4">
            THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, 
            EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, 
            FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">11. Platform Modifications</h2>
          <p className="mb-4">
            We reserve the right to modify, suspend, or discontinue any aspect of the Platform at any time, 
            with or without notice. We are not liable to you or any third party for any such modifications, 
            suspensions, or discontinuations.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">12. Raffle Cancellation</h2>
          <p className="mb-4">
            Raffle creators may cancel raffles in certain circumstances. If a raffle is cancelled:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>Refunds, if applicable, will be processed according to the raffle creator's policies</li>
            <li>The Platform is not responsible for refund processing</li>
            <li>Participants are advised to review individual raffle terms</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">13. Raffle Policy and Minimum Requirements</h2>
          <p className="mb-4">
            Minimum ticket thresholds, automatic end-time extensions, refund eligibility for failed minimums on funds-escrow raffles, NFT escrow and claims, and weighted winner selection are governed by <strong>Section 6 (Prize Distribution)</strong> and <strong>Section 5 (Entry and Payment)</strong>. Only confirmed entries count toward thresholds and draws. The Platform may process ended raffles, extensions, and draws on a schedule and/or through administrative tools.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">14. Intellectual Property</h2>
          <p className="mb-4">
            All content on the Platform, including but not limited to text, graphics, logos, and software, 
            is the property of {PLATFORM_NAME} or its licensors and is protected by copyright and other intellectual property laws.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">15. Privacy</h2>
          <p className="mb-4">
            While transactions on the blockchain are public, we respect your privacy. 
            Please review our privacy practices and understand that wallet addresses may be publicly visible 
            as part of blockchain transactions.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">16. Governing Law</h2>
          <p className="mb-4">
            These Terms shall be governed by and construed in accordance with applicable laws, 
            without regard to conflict of law provisions. Any disputes arising from these Terms 
            or your use of the Platform shall be resolved in the appropriate jurisdiction.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">17. Changes to Terms</h2>
          <p className="mb-4">
            We reserve the right to modify these Terms of Service at any time. 
            Your continued use of the Platform after any changes constitutes acceptance of the new terms. 
            We encourage you to review these Terms periodically.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">18. Contact</h2>
          <p className="mb-4">
            If you have any questions about these Terms of Service, please contact us through the Platform.
          </p>
        </section>

        <section className="mb-8 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="font-semibold mb-2">Important Notice:</p>
          <p>
            Participation in raffles involves risk. Only participate with funds you can afford to lose. 
            Cryptocurrency transactions are irreversible. Please ensure you understand the risks involved 
            before participating in any raffle on this Platform.
          </p>
        </section>
      </div>
    </div>
  )
}
