import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export const metadata = {
  title: 'Terms of Service | Owl Raffle',
  description: 'Terms of Service for Owl Raffle platform',
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
        <p className="text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString()}</p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
          <p className="mb-4">
            By accessing and using Owl Raffle ("the Platform"), you accept and agree to be bound by the terms and provision of this agreement. 
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
            Owl Raffle is a decentralized platform that facilitates raffles using blockchain technology:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>Participants purchase entries using cryptocurrency (USDC or SOL)</li>
            <li>Each entry corresponds to one ticket in the raffle</li>
            <li>Winners are selected randomly from all valid entries</li>
            <li>All transactions are recorded on the blockchain for transparency</li>
            <li>The Platform uses Owl Vision trust scoring to ensure fairness</li>
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
            <li>All payments must be made in the accepted cryptocurrencies (USDC or SOL)</li>
            <li>Transactions are final and cannot be refunded</li>
            <li>Entry prices are set by raffle creators and displayed before purchase</li>
            <li>You must ensure you have sufficient balance for gas/transaction fees</li>
            <li>Failed transactions do not result in entry purchases</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">6. Prize Distribution</h2>
          <p className="mb-4">
            Winners will be selected according to the rules of each individual raffle:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li>Winners are selected randomly using verifiable methods</li>
            <li>Prize distribution occurs after the raffle end time</li>
            <li>Winners will be notified through the Platform</li>
            <li>Prizes are distributed directly to the winner's wallet address</li>
            <li>The Platform is not responsible for prizes after distribution</li>
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
          <h2 className="text-2xl font-semibold mb-4">13. Raffle Policy</h2>
          <p className="mb-4">
            In the event that the minimum number of tickets is not sold by the scheduled end date, the raffle will be extended for an additional seven (7) days.
          </p>
          <p className="mb-4">
            If the minimum requirement is still not met after the extension period, all participants will receive a full refund.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">14. Intellectual Property</h2>
          <p className="mb-4">
            All content on the Platform, including but not limited to text, graphics, logos, and software, 
            is the property of Owl Raffle or its licensors and is protected by copyright and other intellectual property laws.
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
