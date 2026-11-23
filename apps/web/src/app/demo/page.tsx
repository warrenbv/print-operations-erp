// The demo guide: the steps through the quote-to-order journey with the fictional Demo Printworks data.
// It exists only in demonstration mode (apps/web/src/lib/portfolio-demo.ts) and is not found otherwise.
import { COLOR, PageLede, PageShell, SPACE } from '@erp/ui';
import { notFound } from 'next/navigation';
import { isPortfolioDemo } from '../../lib/portfolio-demo';

export const metadata = { title: 'Demo guide' };

export default function DemoGuidePage() {
  if (!isPortfolioDemo()) notFound();
  return (
    <PageShell>
      <h1>Follow a quote to a confirmed order</h1>
      <PageLede>
        Demo Printworks is a fictional print and paper-converting business. Explore how a customer
        request moves through pricing, production review, and order creation.
      </PageLede>
      <p style={{ color: COLOR.muted }}>
        Every customer, contact, and price in this edition is demonstration data. Changes last only
        until the demo restarts.
      </p>
      <ol style={{ lineHeight: 1.7, paddingLeft: SPACE.xxl, maxWidth: 760 }}>
        <li>
          <strong>Start as Sales.</strong> Find <strong>Northstar Demo Packaging</strong> and start
          a quote. Choose Kraft 30# Long roll, width 12 inches, and 10 rolls. Choose Non-taxable for
          this fictional order, then price the line.
        </li>
        <li>
          <strong>Review the handoff.</strong> The quote needs a production lead time before Sales
          can send it. Use <strong>Switch demo role</strong> and enter as Production Manager.
        </li>
        <li>
          <strong>Supply lead time.</strong> Open the quote from the work queue, enter 10 calendar
          days, and save. Then switch back to Sales.
        </li>
        <li>
          <strong>Send and convert.</strong> Open the quote, review the totals, and send it. Demo
          messages stay local. Convert the quote with the fictional PO number{' '}
          <strong>PO-DEMO-1</strong>.
        </li>
        <li>
          <strong>Inspect the result.</strong> The order retains the quote, price, and PO, and shows
          who must act next.
        </li>
        <li>
          <strong>Confirm the order.</strong> Switch to Production Manager, open the order, and
          confirm the committed lead time. The order takes its job number. Then switch back to Sales
          and email the order confirmation.
        </li>
      </ol>
      <p>
        <a href="/quoting/quotes/new?q=Northstar%20Demo%20Packaging">
          Start a quote for Northstar Demo Packaging
        </a>
      </p>
      <p>
        <a href="/">Return to your work queue</a>
      </p>
      <h2>What to notice</h2>
      <p style={{ maxWidth: 760, lineHeight: 1.6 }}>
        Sales controls pricing and the customer offer. Production controls the promised lead time
        and order confirmation. The same record connects the decisions, so a handoff does not
        require re-entering the customer request.
      </p>
    </PageShell>
  );
}
