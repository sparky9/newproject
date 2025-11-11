import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Legal</p>
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-muted-foreground">
          This Privacy Policy describes how Online C-Suite (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
          &ldquo;our&rdquo;) collects, uses, and protects data when you use the Online C-Suite
          platform (the &ldquo;Services&rdquo;). Customize these disclosures with counsel before distributing
          externally.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Information We Collect</h2>
        <p className="text-muted-foreground">
          We collect information that workspace administrators and users provide directly, such as names,
          email addresses, role designations, uploaded documents, chat transcripts, and task inputs. We
          also process integration data synchronized from connected systems (for example, calendar
          events or financial metrics) when configured by your organization. Diagnostic and usage data
          (device information, IP address, feature metrics) is captured to secure and improve the
          Services.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. How We Use Information</h2>
        <p className="text-muted-foreground">
          Collected data supports core functionality, including generating AI insights, maintaining
          conversation history, executing automated tasks, and delivering analytics. We use aggregated or
          anonymized metrics to improve product performance. Processing relies on secure infrastructure
          and vetted subprocessors documented in our data processing addendum. We do not sell Customer
          Data or use it for advertising.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Sharing and Disclosure</h2>
        <p className="text-muted-foreground">
          We share information with service providers that support hosting, AI processing, observability,
          and customer success, each bound by confidentiality obligations. We may disclose data when
          required by law or to protect the rights, property, or safety of Online C-Suite, our users, or
          the public. If Online C-Suite participates in a corporate transaction, affected customers will
          receive notice and choices where required.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Your Choices and Rights</h2>
        <p className="text-muted-foreground">
          Workspace administrators can configure retention periods, request exports, or delete Customer
          Data through in-product controls or by contacting our support team. Depending on jurisdiction,
          users may have rights to access, correct, or restrict processing of personal information.
          Submit privacy inquiries by emailing{' '}
          <a href="mailto:privacy@online-csuite.example" className="underline underline-offset-4">
            privacy@online-csuite.example
          </a>
          . We respond in accordance with applicable data-protection laws.
        </p>
      </section>

      <p className="text-sm text-muted-foreground">
        Learn more about security safeguards in our{' '}
        <Link href="/docs/security" className="underline underline-offset-4">
          security documentation
        </Link>
        , or contact your customer success representative for tailored compliance materials.
      </p>
    </main>
  );
}
