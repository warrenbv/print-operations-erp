// The browser journey from quote to confirmed order, as the demonstration's Sales and Production
// Manager accounts: docs/product/requirements.md (R5, R8, R9, R10, R11). The priced line is read off
// the Lines step and pinned once to literal values. Every later screen, the review page and the order
// page, is compared with what was read there, so a figure that changes between screens fails.
// Each role refusal is asserted at the API with a real session for the wrong role, and the record is
// re-read to show nothing changed. Run by `pnpm test:portfolio`. The tests share one quote in order.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const apiUrl = `http://127.0.0.1:${process.env.PORTFOLIO_API_PORT ?? '4331'}`;

const CUSTOMER = 'Northstar Demo Packaging';
const CONTACT_EMAIL = 'alex@example.test';
const PO_NUMBER = 'PO-DEMO-1';
const LEAD_TIME_DAYS = 10;

type DemoRole = 'Sales' | 'Production Manager';
const API_ROLE: Record<DemoRole, string> = {
  Sales: 'Sales',
  'Production Manager': 'ProductionManager',
};

interface PricedLine {
  title: string;
  paper: string;
  size: string;
  quantity: string;
  shipping: string;
  unitPrice: string;
  lineTotal: string;
  weight: string;
  taxTreatment: string;
  quoteTotal: string;
}

interface QuoteJson {
  status: string;
  lockVersion: number;
  leadTimeDays?: number | null;
  lines: { quantityRolls: number; taxStatus: string; pricePerRoll: string }[];
}

interface OrderJson {
  status: string;
  lockVersion: number;
  jobNumber?: string | null;
  poNumber?: string | null;
  confirmedLeadTimeDays?: number | null;
  confirmedBy?: string | null;
  lines: {
    quantityRolls: number;
    taxStatus: string;
    pricePerRoll: string;
    extendedPrice: string;
  }[];
}

interface SendJson {
  recipients: string[];
  audience: string;
  outcome: string;
  actor: string;
}

const journey: { quoteId?: string; orderId?: string; priced?: PricedLine } = {};

function quoteId(): string {
  if (journey.quoteId === undefined) throw new Error('The quote was not created.');
  return journey.quoteId;
}

function orderId(): string {
  if (journey.orderId === undefined) throw new Error('The order was not created.');
  return journey.orderId;
}

function priced(): PricedLine {
  if (journey.priced === undefined) throw new Error('The line was not priced.');
  return journey.priced;
}

async function signIn(page: Page, role: DemoRole): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: `Try ${role}`, exact: true }).click();
  await page.waitForURL('/');
}

async function switchRole(page: Page, role: DemoRole): Promise<void> {
  await page.getByRole('button', { name: 'Switch demo role', exact: true }).click();
  await page.getByRole('button', { name: `Try ${role}`, exact: true }).click();
  await page.waitForURL('/');
}

// Proves a refusal comes from the role rule: the session holds the named role and none of the others.
async function expectSessionRole(request: APIRequestContext, role: DemoRole): Promise<void> {
  const me = await request.get(`${apiUrl}/auth/me`);
  expect(me.status()).toBe(200);
  const body = (await me.json()) as { roles: string[] };
  expect(body.roles).toContain(API_ROLE[role]);
  for (const other of Object.values(API_ROLE).filter((name) => name !== API_ROLE[role])) {
    expect(body.roles).not.toContain(other);
  }
}

async function readQuote(request: APIRequestContext): Promise<QuoteJson> {
  const response = await request.get(`${apiUrl}/quoting/quotes/${quoteId()}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as QuoteJson;
}

async function readOrder(request: APIRequestContext): Promise<OrderJson> {
  const response = await request.get(`${apiUrl}/orders/${orderId()}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as OrderJson;
}

async function readSends(request: APIRequestContext, path: string): Promise<SendJson[]> {
  const response = await request.get(`${apiUrl}${path}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { items: SendJson[] }).items;
}

function demoLineRequest(quantityRolls: number) {
  return {
    gradeId: '01988a00-0005-7000-8000-000000000001',
    footageVariant: 'long',
    rollWidthIn: 12,
    quantityRolls,
    taxTreatment: { taxStatus: 'non_tax' },
  };
}

function definition(scope: Locator, term: string): Locator {
  return scope
    .locator('dt')
    .filter({ hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

async function readLineRow(page: Page): Promise<{
  title: string;
  shipping: string;
  unitPrice: string;
  lineTotal: string;
}> {
  const row = page.locator('main #line-1');
  const spans = row.locator(':scope > span');
  const title = (await spans.nth(0).innerText()).trim();
  const shipping = (await spans.nth(1).innerText()).trim();
  const money = (await spans.nth(2).innerText()).replace(/\s+/g, ' ');
  const match = /^(\$[\d,]+\.\d{2}) \/ roll(?: delivered)? · (\$[\d,]+\.\d{2})/.exec(money);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Line 1 shows no price per roll and line total: ${money}`);
  }
  return { title, shipping, unitPrice: match[1], lineTotal: match[2] };
}

async function expectOrderCarriesQuote(page: Page): Promise<void> {
  const line = priced();
  const row = await readLineRow(page);
  expect(row).toEqual({
    title: line.title,
    shipping: line.shipping,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
  });
  const main = page.locator('main');
  await expect(definition(main, 'Customer PO')).toContainText(PO_NUMBER);
  await expect(definition(main, 'Quote')).toHaveText(
    `Q-00001, lead time quoted ${String(LEAD_TIME_DAYS)} days`,
  );
  const totals = main
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: /^Totals/ }) });
  await totals.locator('summary').click();
  await expect(definition(totals, 'Extended price')).toHaveText(line.quoteTotal);
  await expect(definition(totals, 'Estimated weight')).toHaveText(line.weight);
  const order = await readOrder(page.request);
  expect(order.poNumber).toBe(PO_NUMBER);
  expect(order.lines).toHaveLength(1);
  expect(order.lines[0]?.quantityRolls).toBe(Number(line.quantity));
  expect(order.lines[0]?.taxStatus).toBe('non_tax');
}

test.describe.serial('quote to confirmed order', () => {
  test('Sales prices the demo line at $11.08 a roll and $110.83 in total, and the server refuses Sales setting the lead time', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Explore Print Operations ERP' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Portfolio demo' })).toContainText(
      'Fictional data',
    );
    await signIn(page, 'Sales');
    await page.goto(`/quoting/quotes/new?q=${encodeURIComponent(CUSTOMER)}`);
    await page.getByRole('button', { name: 'Start quote', exact: true }).click();
    await page.waitForURL(/\/quoting\/quotes\/[a-f0-9-]+$/);
    journey.quoteId = new URL(page.url()).pathname.split('/').pop();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      `Quote Q-00001 for ${CUSTOMER}`,
    );

    await page
      .locator('select[name="lines[0].paper"]')
      .selectOption('01988a00-0005-7000-8000-000000000001:long');
    await page.getByRole('button', { name: 'Choose widths', exact: true }).click();
    await page.locator('select[name="lines[0].rollWidthIn"]').selectOption('12');
    await page.locator('input[name="lines[0].quantityRolls"]').fill('10');
    await page.locator('select[name="lines[0].taxStatus"]').selectOption('non_tax');
    await page.getByRole('button', { name: 'Price line 1', exact: true }).click();
    await expect(page.locator('main')).toContainText(/So far:\s*1\s*priced\s*line/);

    const row = await readLineRow(page);
    const titleMatch = /^Line 1 · (.+) · (\d+" × [\d,]+ ft) · (\d+) rolls$/.exec(row.title);
    if (
      titleMatch?.[1] === undefined ||
      titleMatch[2] === undefined ||
      titleMatch[3] === undefined
    ) {
      throw new Error(`Line 1 title does not name paper, size and quantity: ${row.title}`);
    }
    const weightText = await page
      .locator('main #line-1')
      .getByText(/^Estimated weight/)
      .innerText();
    const soFar = await page
      .locator('main')
      .getByText(/^So far:/)
      .innerText();
    const totalMatch = /priced line, (\$[\d,]+\.\d{2})\./.exec(soFar);
    const taxStep = page.getByRole('navigation', { name: 'Quote steps' }).locator('small').nth(2);
    journey.priced = {
      ...row,
      paper: titleMatch[1],
      size: titleMatch[2],
      quantity: titleMatch[3],
      weight: weightText.replace(/^Estimated weight\s*/, '').trim(),
      taxTreatment: (await taxStep.innerText()).trim(),
      quoteTotal: totalMatch?.[1] ?? soFar,
    };

    expect(journey.priced).toEqual({
      title: 'Line 1 · Kraft — 30# · 12" × 1,250 ft · 10 rolls',
      paper: 'Kraft — 30#',
      size: '12" × 1,250 ft',
      quantity: '10',
      shipping: 'Customer pickup - Demo Printworks plant',
      unitPrice: '$11.08',
      lineTotal: '$110.83',
      weight: '125.00 lb',
      taxTreatment: 'Collected at the plant, Non-taxable',
      quoteTotal: '$110.83',
    });

    await expect(page.getByText('Lead time: waiting on Production', { exact: true })).toBeVisible();
    await expect(page.locator('input[name="leadTimeDays"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save lead time', exact: true })).toHaveCount(0);

    await expectSessionRole(page.request, 'Sales');
    const before = await readQuote(page.request);
    expect(before.leadTimeDays ?? null).toBeNull();
    const refused = await page.request.put(`${apiUrl}/quoting/quotes/${quoteId()}/lead-time`, {
      data: { leadTimeDays: 3, lockVersion: before.lockVersion },
    });
    expect(refused.status()).toBe(403);
    const after = await readQuote(page.request);
    expect(after.leadTimeDays ?? null).toBeNull();
    expect(after.lockVersion).toBe(before.lockVersion);
  });

  test('the Production Manager sets a 10 day lead time, and the server refuses it pricing a line or sending the quote', async ({
    page,
  }) => {
    await signIn(page, 'Production Manager');
    await expect(
      page.getByRole('link', { name: new RegExp(`Q-00001.*${CUSTOMER}`) }),
    ).toBeVisible();
    await page.goto(`/quoting/quotes/${quoteId()}`);
    await expect(
      page.getByText('Only Sales prices and sends a quote.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Price line/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Edit line/ })).toHaveCount(0);

    await expectSessionRole(page.request, 'Production Manager');
    const before = await readQuote(page.request);
    expect(before.status).toBe('draft');
    const pricing = await page.request.put(`${apiUrl}/quoting/quotes/${quoteId()}/lines`, {
      data: { lines: [demoLineRequest(99)], lockVersion: before.lockVersion },
    });
    expect(pricing.status()).toBe(403);
    const sending = await page.request.post(`${apiUrl}/quoting/quotes/${quoteId()}/send`, {
      data: { lockVersion: before.lockVersion, confirmRecipients: [CONTACT_EMAIL] },
    });
    expect(sending.status()).toBe(403);
    const after = await readQuote(page.request);
    expect(after.status).toBe('draft');
    expect(after.lockVersion).toBe(before.lockVersion);
    expect(after.lines.map((line) => line.quantityRolls)).toEqual([10]);
    const customerSends = (
      await readSends(page.request, `/quoting/quotes/${quoteId()}/sends`)
    ).filter((send) => send.audience === 'customer');
    expect(customerSends).toEqual([]);

    await page.locator('input[name="leadTimeDays"]').fill(String(LEAD_TIME_DAYS));
    await page.getByRole('button', { name: 'Save lead time', exact: true }).click();
    await expect(
      page.getByText(`Lead time saved: ${String(LEAD_TIME_DAYS)} days.`, { exact: true }),
    ).toBeVisible();
    expect((await readQuote(page.request)).leadTimeDays).toBe(LEAD_TIME_DAYS);
  });

  test('the review page shows the line, total, lead time and tax treatment Sales priced, and sending marks the quote Quoted', async ({
    page,
  }) => {
    const line = priced();
    await signIn(page, 'Sales');
    await page.goto(`/quoting/quotes/${quoteId()}/review`);
    const main = page.locator('main');
    await expect(main).toContainText(/DEMO\s*PRINTWORKS/i);
    await expect(main).toContainText(CUSTOMER);
    await expect(
      page.getByRole('navigation', { name: 'Quote steps' }).locator('small').nth(2),
    ).toHaveText(line.taxTreatment);
    await expect(main).toContainText(
      `Production entered the lead time: ${String(LEAD_TIME_DAYS)} days`,
    );
    await expect(definition(main, 'Lead time')).toHaveText(`${String(LEAD_TIME_DAYS)} days`);

    const documentRow = main
      .getByRole('table')
      .filter({ hasText: 'Price / roll' })
      .getByRole('row')
      .filter({ hasText: line.paper });
    const cells = documentRow.getByRole('cell');
    await expect(cells).toHaveCount(7);
    await expect(cells.nth(1)).toContainText(`${line.paper} · ${line.size}`);
    await expect(cells.nth(2)).toHaveText(line.quantity);
    await expect(cells.nth(3)).toHaveText(line.unitPrice);
    await expect(cells.nth(4)).toHaveText(line.shipping);
    await expect(cells.nth(6)).toHaveText(line.lineTotal);
    await expect(main.getByText(/^Total:/)).toHaveText(`Total: ${line.quoteTotal}`);

    await page.getByRole('button', { name: `Send quote to ${CONTACT_EMAIL}`, exact: true }).click();
    await expect(main.getByText(`Quote sent to ${CONTACT_EMAIL} at`)).toBeVisible();
    await expect(page.locator('main').getByText('Quoted', { exact: true })).toBeVisible();
    const quote = await readQuote(page.request);
    expect(quote.status).toBe('quoted');
    const customerSends = (
      await readSends(page.request, `/quoting/quotes/${quoteId()}/sends`)
    ).filter((send) => send.audience === 'customer');
    expect(customerSends).toHaveLength(1);
    expect(customerSends[0]?.recipients).toEqual([CONTACT_EMAIL]);
    expect(customerSends[0]?.outcome).toBe('accepted');
  });

  test('converting with PO-DEMO-1 creates an order carrying the quote figures, and the server refuses Sales confirming it', async ({
    page,
  }) => {
    await signIn(page, 'Sales');
    await page.goto(`/quoting/quotes/${quoteId()}`);
    await page.getByRole('link', { name: 'Convert to order', exact: true }).click();
    await page.locator('input[name="poNumber"]').fill(PO_NUMBER);
    await page.getByRole('button', { name: 'Create 1 order', exact: true }).click();
    await page.waitForURL(/\/orders\/[a-f0-9-]+/);
    journey.orderId = new URL(page.url()).pathname.split('/').pop();

    await expect(
      page.getByRole('heading', { name: `Order from Q-00001 for ${CUSTOMER}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Waiting on the Production Manager to confirm the order' }),
    ).toBeVisible();
    await expect(definition(page.locator('main'), 'Job number')).toHaveText(
      'Given on confirmation',
    );
    await expect(page.getByRole('button', { name: 'Confirm the order', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('link', { name: 'Demo guide', exact: true })).toBeVisible();
    await expectOrderCarriesQuote(page);

    await expectSessionRole(page.request, 'Sales');
    const before = await readOrder(page.request);
    expect(before.status).toBe('converted');
    const refused = await page.request.post(`${apiUrl}/orders/${orderId()}/confirm`, {
      data: { lockVersion: before.lockVersion, confirmedLeadTimeDays: 3 },
    });
    expect(refused.status()).toBe(403);
    const after = await readOrder(page.request);
    expect(after.status).toBe('converted');
    expect(after.jobNumber ?? null).toBeNull();
    expect(after.lockVersion).toBe(before.lockVersion);
  });

  test('the Production Manager confirms the order as job DPW-00001 with the quoted lead time and the figures unchanged', async ({
    page,
  }) => {
    await signIn(page, 'Production Manager');
    await expect(
      page.getByRole('link', { name: new RegExp(`Order from Q-00001.*${CUSTOMER}`) }),
    ).toBeVisible();
    await page.goto(`/orders/${orderId()}`);
    await expect(page.locator('input[name="confirmedLeadTimeDays"]')).toHaveValue(
      String(LEAD_TIME_DAYS),
    );
    await page.getByRole('button', { name: 'Confirm the order', exact: true }).click();
    await expect(
      page.getByText('Order confirmed. Job number DPW-00001.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: `DPW-00001 for ${CUSTOMER}` }),
    ).toBeVisible();
    const main = page.locator('main');
    await expect(definition(main, 'Job number')).toHaveText('DPW-00001');
    await expect(definition(main, 'Committed lead time')).toContainText(
      `${String(LEAD_TIME_DAYS)} days, due`,
    );
    await expect(page.getByRole('button', { name: 'Confirm the order', exact: true })).toHaveCount(
      0,
    );
    await expectOrderCarriesQuote(page);

    const order = await readOrder(page.request);
    expect(order.status).toBe('confirmed');
    expect(order.jobNumber).toBe('DPW-00001');
    expect(order.confirmedLeadTimeDays).toBe(LEAD_TIME_DAYS);
  });

  test('Sales emails the order confirmation, and the order records the send and files the PDF', async ({
    page,
  }) => {
    await signIn(page, 'Sales');
    await page.goto(`/orders/${orderId()}`);
    const main = page.locator('main');
    await expect(
      page.getByRole('heading', { level: 1, name: `DPW-00001 for ${CUSTOMER}` }),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: `Email the order confirmation to ${CONTACT_EMAIL}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByText(`Order confirmation emailed to ${CONTACT_EMAIL}.`, { exact: true }),
    ).toBeVisible();
    await expect(definition(main, 'Order confirmation')).toContainText(
      `Emailed to ${CONTACT_EMAIL} on`,
    );
    await expectOrderCarriesQuote(page);

    const documents = main.locator('details').filter({
      has: page.locator('summary', { hasText: /^Documents \(1\)/ }),
    });
    await documents.locator('summary').click();
    const pdfLink = documents.getByRole('link', {
      name: /^order-confirmation-DPW-00001-\d{8}\.pdf$/,
    });
    await expect(pdfLink).toBeVisible();
    const href = await pdfLink.getAttribute('href');
    expect(href).not.toBeNull();
    const pdf = await page.request.get(href ?? '');
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const customerSends = (await readSends(page.request, `/orders/${orderId()}/sends`)).filter(
      (send) => send.audience === 'customer',
    );
    expect(customerSends).toHaveLength(1);
    expect(customerSends[0]?.recipients).toEqual([CONTACT_EMAIL]);
    expect(customerSends[0]?.outcome).toBe('accepted');

    // The send log names Sales, who sent it, not the Production Manager, who confirmed the order.
    const me = await page.request.get(`${apiUrl}/auth/me`);
    expect(me.status()).toBe(200);
    const sender = ((await me.json()) as { username: string }).username;
    const order = await readOrder(page.request);
    expect(order.confirmedBy).toBeTruthy();
    expect(order.confirmedBy).not.toBe(sender);
    expect(customerSends[0]?.actor).toBe(sender);
  });

  test('a converted quote lists its order and can no longer be changed, its order cannot be confirmed twice, and the convert page counts the rolls already ordered', async ({
    page,
  }) => {
    await signIn(page, 'Sales');
    await page.goto(`/quoting/quotes/${quoteId()}`);
    const main = page.locator('main');
    await expect(main.getByText('Quoted, 1 order so far', { exact: true }).first()).toBeVisible();
    await expect(
      main.getByRole('link', { name: 'Create another order', exact: true }),
    ).toBeVisible();
    const orderRow = main
      .getByRole('table')
      .filter({ hasText: 'PO number' })
      .getByRole('row')
      .filter({ hasText: 'DPW-00001' });
    await expect(orderRow.getByRole('cell')).toHaveText([
      'DPW-00001',
      PO_NUMBER,
      'None given',
      `Line 1: ${priced().quantity} rolls`,
      'Confirmed',
    ]);
    await expect(page.getByRole('button', { name: /^Price line/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Edit line/ })).toHaveCount(0);

    const quote = await readQuote(page.request);
    const edit = await page.request.put(`${apiUrl}/quoting/quotes/${quoteId()}/lines`, {
      data: { lines: [demoLineRequest(99)], lockVersion: quote.lockVersion },
    });
    expect(edit.status()).toBe(409);
    expect(await edit.json()).toEqual({ reason: 'quote-not-editable', value: 'quoted' });
    const unchanged = await readQuote(page.request);
    expect(unchanged.lines.map((line) => line.quantityRolls)).toEqual([10]);
    expect(unchanged.lockVersion).toBe(quote.lockVersion);

    await page.goto(`/quoting/quotes/${quoteId()}/convert`);
    const convertRow = page.getByRole('row').filter({ hasText: /^Line 1/ });
    await expect(convertRow.getByRole('rowheader')).toContainText(`${priced().unitPrice}/roll`);
    await expect(convertRow.getByRole('cell').nth(0)).toHaveText(`${priced().quantity} rolls`);
    await expect(convertRow.getByRole('cell').nth(1)).toHaveText(`${priced().quantity} rolls`);

    await switchRole(page, 'Production Manager');
    await expectSessionRole(page.request, 'Production Manager');
    const order = await readOrder(page.request);
    const again = await page.request.post(`${apiUrl}/orders/${orderId()}/confirm`, {
      data: { lockVersion: order.lockVersion, confirmedLeadTimeDays: 3 },
    });
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { reason: string }).reason).toBe('invalid-transition');
    const still = await readOrder(page.request);
    expect(still.jobNumber).toBe('DPW-00001');
    expect(still.confirmedLeadTimeDays).toBe(LEAD_TIME_DAYS);
  });

  test('requests without a session are refused by the API and the order page shows no record', async ({
    page,
    playwright,
  }) => {
    const anonymous = await playwright.request.newContext();
    try {
      const reads = [`/quoting/quotes/${quoteId()}`, `/orders/${orderId()}`, '/auth/me'];
      for (const path of reads) {
        expect((await anonymous.get(`${apiUrl}${path}`)).status(), path).toBe(401);
      }
      const pricing = await anonymous.put(`${apiUrl}/quoting/quotes/${quoteId()}/lines`, {
        data: { lines: [demoLineRequest(99)], lockVersion: 1 },
      });
      expect(pricing.status()).toBe(401);
      const confirming = await anonymous.post(`${apiUrl}/orders/${orderId()}/confirm`, {
        data: { lockVersion: 1, confirmedLeadTimeDays: 3 },
      });
      expect(confirming.status()).toBe(401);
      const converting = await anonymous.post(`${apiUrl}/orders`, {
        data: { quoteId: quoteId(), poNumber: 'PO-ANON' },
      });
      expect(converting.status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }

    await page.goto(`/orders/${orderId()}`);
    await expect(page.getByText('Sign in to view this page.', { exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('DPW-00001');
    await expect(page.locator('main')).not.toContainText(PO_NUMBER);
  });
});
