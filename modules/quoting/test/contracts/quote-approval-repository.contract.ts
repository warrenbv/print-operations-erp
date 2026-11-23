// The contract for `QuoteApprovalRepository` in modules/quoting/src/ports.ts. One set of
// assertions, run against the in-memory and the Drizzle adapter by
// modules/quoting/test/repository-contracts.test.ts. It pins down requesting and deciding
// credit-hold exceptions, at most one unspent exception per customer, and spending it with the
// quote it permits: docs/product/requirements.md (R2). A failure means one adapter breaks a promise
// the other keeps: docs/process/verifying-agent-written-code.md.
import { newId } from '@erp/db';
import { describe, expect, it } from 'vitest';

import {
  QuoteApprovalAlreadyDecidedError,
  UnspentQuoteApprovalExistsError,
  type NewQuoteApproval,
  type QuoteApprovalRepository,
  type QuoteRepository,
} from '../../src/ports';

export function quoteApprovalRepositoryContract(
  makeRepos: () => Promise<{
    approvals: QuoteApprovalRepository;
    quotes: QuoteRepository;
    newQuoteRow: (customerId: string) => Parameters<QuoteRepository['create']>[0];
  }>,
): void {
  const AT = new Date('2026-08-19T19:00:00.000Z');

  const request = (over: Partial<NewQuoteApproval> = {}): NewQuoteApproval => ({
    id: newId(),
    customerId: newId(),
    reason: 'Long-standing account, PO already in hand',
    requestedBy: 'jsmith',
    requestedAt: AT,
    ...over,
  });

  describe('request', () => {
    it('starts pending, with the requester and their reason on the record', async () => {
      const { approvals } = await makeRepos();
      const input = request();

      const created = await approvals.request(input);

      expect(created).toMatchObject({
        customerId: input.customerId,
        status: 'pending',
        reason: 'Long-standing account, PO already in hand',
        requestedBy: 'jsmith',
      });

      expect(created.decidedBy).toBeUndefined();
      expect(created.decidedAt).toBeUndefined();
      expect(created.spentByQuoteId).toBeUndefined();
    });

    it('allows a second request while the first is still pending', async () => {
      const { approvals } = await makeRepos();
      const customerId = newId();
      await approvals.request(request({ customerId }));

      await expect(approvals.request(request({ customerId }))).resolves.toMatchObject({
        status: 'pending',
      });
    });
  });

  describe('decide', () => {
    it('approves, recording who and when, with no second reason', async () => {
      const { approvals } = await makeRepos();
      const created = await approvals.request(request());

      const decided = await approvals.decide(created.id, {
        decision: 'approved',
        decidedBy: 'bmanager',
        decidedAt: AT,
      });

      expect(decided).toMatchObject({ status: 'approved', decidedBy: 'bmanager' });

      expect(decided?.decisionReason).toBeUndefined();
    });

    it('rejects with the decider’s own reason', async () => {
      const { approvals } = await makeRepos();
      const created = await approvals.request(request());

      const decided = await approvals.decide(created.id, {
        decision: 'rejected',
        decidedBy: 'bmanager',
        decidedAt: AT,
        reason: 'Balance is 90 days out; collect first',
      });

      expect(decided).toMatchObject({
        status: 'rejected',
        decisionReason: 'Balance is 90 days out; collect first',
      });
    });

    it('answers null for an unknown id', async () => {
      const { approvals } = await makeRepos();

      expect(
        await approvals.decide(newId(), {
          decision: 'approved',
          decidedBy: 'bmanager',
          decidedAt: AT,
        }),
      ).toBeNull();
    });

    it('refuses a second decision on the same request', async () => {
      const { approvals } = await makeRepos();
      const created = await approvals.request(request());
      await approvals.decide(created.id, {
        decision: 'approved',
        decidedBy: 'bmanager',
        decidedAt: AT,
      });

      await expect(
        approvals.decide(created.id, {
          decision: 'rejected',
          decidedBy: 'someone-else',
          decidedAt: AT,
          reason: 'changed my mind',
        }),
      ).rejects.toBeInstanceOf(QuoteApprovalAlreadyDecidedError);
    });

    it('refuses to bank a second unspent approval for one customer', async () => {
      const { approvals } = await makeRepos();
      const customerId = newId();
      const first = await approvals.request(request({ customerId }));
      const second = await approvals.request(request({ customerId }));
      await approvals.decide(first.id, {
        decision: 'approved',
        decidedBy: 'bmanager',
        decidedAt: AT,
      });

      await expect(
        approvals.decide(second.id, {
          decision: 'approved',
          decidedBy: 'bmanager',
          decidedAt: AT,
        }),
      ).rejects.toBeInstanceOf(UnspentQuoteApprovalExistsError);
    });

    it('allows a rejection while an unspent approval exists', async () => {
      const { approvals } = await makeRepos();
      const customerId = newId();
      const first = await approvals.request(request({ customerId }));
      const second = await approvals.request(request({ customerId }));
      await approvals.decide(first.id, {
        decision: 'approved',
        decidedBy: 'bmanager',
        decidedAt: AT,
      });

      await expect(
        approvals.decide(second.id, {
          decision: 'rejected',
          decidedBy: 'bmanager',
          decidedAt: AT,
          reason: 'duplicate of the one already approved',
        }),
      ).resolves.toMatchObject({ status: 'rejected' });
    });
  });

  describe('listPending', () => {
    it('returns only pending rows, oldest first', async () => {
      const { approvals } = await makeRepos();
      const older = await approvals.request(
        request({ requestedAt: new Date(AT.getTime() - 60_000) }),
      );
      const newer = await approvals.request(request({ requestedAt: AT }));
      const decided = await approvals.request(request());
      await approvals.decide(decided.id, {
        decision: 'approved',
        decidedBy: 'bmanager',
        decidedAt: AT,
      });

      const pending = await approvals.listPending();

      expect(pending.map((row) => row.id)).toEqual([older.id, newer.id]);
    });
  });

  describe('listForCustomer', () => {
    it('returns every status for that account, newest first, and nobody else', async () => {
      const { approvals } = await makeRepos();
      const customerId = newId();

      const older = await approvals.request(
        request({ customerId, requestedAt: new Date(AT.getTime() - 60_000) }),
      );
      const newer = await approvals.request(request({ customerId, requestedAt: AT }));
      const somebodyElse = await approvals.request(request());

      await approvals.decide(older.id, {
        decision: 'rejected',
        decidedBy: 'bmanager',
        decidedAt: AT,
        reason: 'Balance is 90 days out',
      });

      const rows = await approvals.listForCustomer(customerId);

      expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);

      expect(rows[1]).toMatchObject({
        status: 'rejected',
        decisionReason: 'Balance is 90 days out',
      });
      expect(rows.map((row) => row.id)).not.toContain(somebodyElse.id);
    });

    it('orders two requests taken in the same instant deterministically', async () => {
      const { approvals } = await makeRepos();
      const customerId = newId();

      const first = await approvals.request(request({ customerId, requestedAt: AT }));
      const second = await approvals.request(request({ customerId, requestedAt: AT }));

      const ids = (await approvals.listForCustomer(customerId)).map((row) => row.id);

      expect(ids).toEqual([first.id, second.id].sort().reverse());
    });

    it('answers empty for an account nobody has asked about', async () => {
      const { approvals } = await makeRepos();
      expect(await approvals.listForCustomer(newId())).toEqual([]);
    });
  });

  describe('spending the token', () => {
    async function approvedFor(
      repos: Awaited<ReturnType<typeof makeRepos>>,
      customerId: string,
    ): Promise<void> {
      const created = await repos.approvals.request(request({ customerId }));
      await repos.approvals.decide(created.id, {
        decision: 'approved',
        decidedBy: 'bmanager',
        decidedAt: AT,
      });
    }

    it('answers null when the customer holds no approval', async () => {
      const repos = await makeRepos();

      expect(await repos.quotes.createSpendingApproval(repos.newQuoteRow(newId()))).toBeNull();
    });

    it('mints the quote and links the approval to it', async () => {
      const repos = await makeRepos();
      const customerId = newId();
      await approvedFor(repos, customerId);

      const spent = await repos.quotes.createSpendingApproval(repos.newQuoteRow(customerId));

      expect(spent).not.toBeNull();

      expect(spent?.approval.spentByQuoteId).toBe(spent?.quote.id);
      expect(spent?.approval.spentAt).toBeDefined();
      expect(await repos.quotes.findById(spent!.quote.id)).not.toBeNull();
    });

    it('spends the token exactly once — the second quote is refused', async () => {
      const repos = await makeRepos();
      const customerId = newId();
      await approvedFor(repos, customerId);

      const first = await repos.quotes.createSpendingApproval(repos.newQuoteRow(customerId));
      const second = await repos.quotes.createSpendingApproval(repos.newQuoteRow(customerId));

      expect(first).not.toBeNull();

      expect(second).toBeNull();
    });

    it('lets only one of two creates at once spend the token, and the other writes nothing', async () => {
      const repos = await makeRepos();
      const customerId = newId();
      await approvedFor(repos, customerId);
      const rows = [repos.newQuoteRow(customerId), repos.newQuoteRow(customerId)];

      const outcomes = await Promise.allSettled(
        rows.map((row) => repos.quotes.createSpendingApproval(row)),
      );

      expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled']);
      const spent = outcomes.map((o) => (o.status === 'fulfilled' ? o.value : undefined));
      expect(spent.filter((s) => s !== null)).toHaveLength(1);
      const loser = rows[spent.findIndex((s) => s === null)]!;
      expect(await repos.quotes.findById(loser.id)).toBeNull();
      expect(await repos.approvals.findUnspentFor(customerId)).toBeNull();
    });

    it('writes no quote when there was no token to spend', async () => {
      const repos = await makeRepos();
      const before = await repos.quotes.list({});

      await repos.quotes.createSpendingApproval(repos.newQuoteRow(newId()));

      expect(await repos.quotes.list({})).toHaveLength(before.length);
    });

    it('leaves the approval unspendable afterwards', async () => {
      const repos = await makeRepos();
      const customerId = newId();
      await approvedFor(repos, customerId);
      await repos.quotes.createSpendingApproval(repos.newQuoteRow(customerId));

      expect(await repos.approvals.findUnspentFor(customerId)).toBeNull();
    });
  });

  describe('findUnspentFor', () => {
    it('is null while the request is only pending', async () => {
      const { approvals } = await makeRepos();
      const customerId = newId();
      await approvals.request(request({ customerId }));

      expect(await approvals.findUnspentFor(customerId)).toBeNull();
    });

    it('is null after a rejection', async () => {
      const { approvals } = await makeRepos();
      const customerId = newId();
      const created = await approvals.request(request({ customerId }));
      await approvals.decide(created.id, {
        decision: 'rejected',
        decidedBy: 'bmanager',
        decidedAt: AT,
        reason: 'no',
      });

      expect(await approvals.findUnspentFor(customerId)).toBeNull();
    });

    it('does not confuse two customers', async () => {
      const { approvals } = await makeRepos();
      const mine = newId();
      const theirs = newId();
      const created = await approvals.request(request({ customerId: mine }));
      await approvals.decide(created.id, {
        decision: 'approved',
        decidedBy: 'bmanager',
        decidedAt: AT,
      });

      expect(await approvals.findUnspentFor(mine)).not.toBeNull();
      expect(await approvals.findUnspentFor(theirs)).toBeNull();
    });
  });
}
