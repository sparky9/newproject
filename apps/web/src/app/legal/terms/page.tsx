import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Legal</p>
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-muted-foreground">
          These Terms of Service (the &ldquo;Terms&rdquo;) govern access to and use of the Online
          C-Suite platform and related services (collectively, the &ldquo;Services&rdquo;). By creating
          or administering a workspace, your organization (&ldquo;Customer&rdquo;) agrees to these Terms.
          If you are accepting on behalf of Customer, you represent that you have authority to bind the
          Customer to this agreement. Review and finalize this document with legal counsel prior to
          public release.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Service Access</h2>
        <p className="text-muted-foreground">
          Customer may enable authorized users to access the Services for Customer&rsquo;s internal business
          purposes. Customer is responsible for maintaining the confidentiality of account credentials,
          ensuring that usage complies with applicable laws, and preventing abusive or high-risk
          activities (including probing security controls, interfering with other tenants, or misusing
          AI outputs). Online C-Suite may suspend access to address security threats or material policy
          violations and will notify Customer when practical.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. Customer Data</h2>
        <p className="text-muted-foreground">
          Customer retains ownership of data submitted to the Services (&ldquo;Customer Data&rdquo;). Online
          C-Suite will process Customer Data solely to deliver, maintain, and improve the Services, and
          in accordance with the accompanying Privacy Policy. Customer is responsible for obtaining any
          consents necessary for data provided from third-party systems or individuals. Upon written
          request and subject to applicable law, Online C-Suite will delete or return Customer Data
          within a commercially reasonable timeframe.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Fees and Payment</h2>
        <p className="text-muted-foreground">
          Fees, billing cadence, and payment instructions appear on the applicable order form or self-
          service plan. Unless expressly stated otherwise, charges are non-refundable and due within
          thirty (30) days of invoice. Overdue balances may incur late fees or suspension. Customer is
          responsible for taxes tied to its purchases, excluding Online C-Suite&rsquo;s income taxes. Pricing
          adjustments take effect at renewal unless the parties agree in writing to alternate timing.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Warranties and Disclaimers</h2>
        <p className="text-muted-foreground">
          The Services are provided &quot;as is&quot; and &quot;as available&quot;. Online C-Suite disclaims
          all implied warranties to the maximum extent permitted by law, including merchantability,
          fitness for a particular purpose, and non-infringement. Online C-Suite does not warrant that AI
          outputs will be accurate or error-free and recommends human review before acting on generated
          insights.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Limitation of Liability</h2>
        <p className="text-muted-foreground">
          Except for liability that cannot be limited by law, neither party will be liable for indirect,
          incidental, special, or consequential damages, including lost profits or business interruption.
          Each party&rsquo;s aggregate liability arising under these Terms is capped at the amounts paid by
          Customer for the Services in the twelve (12) months preceding the event giving rise to the
          claim. These limitations apply regardless of the theory of liability, to the extent permitted
          by law.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Term, Termination, and Changes</h2>
        <p className="text-muted-foreground">
          These Terms remain in effect for the subscription period specified on the order form and renew
          as described there. Either party may terminate for cause if the other party fails to cure a
          material breach within thirty (30) days of notice. Upon termination, Customer must stop using
          the Services, and Online C-Suite will make Customer Data available for export for a limited
          period. Online C-Suite may update these Terms with prior notice; continued use after the
          effective date constitutes acceptance of the revised Terms.
        </p>
      </section>

      <p className="text-sm text-muted-foreground">
        Questions about this agreement? Contact your Online C-Suite representative or email{' '}
        <a href="mailto:legal@online-csuite.example" className="underline underline-offset-4">
          legal@online-csuite.example
        </a>{' '}
        for assistance.
      </p>
    </main>
  );
}
