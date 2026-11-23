// End-to-end over HTTP: paper grades, their Billing Manager gate, validation and conflicts.
import { DEV_USERNAMES } from '@erp/identity';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DEV_PASSWORD = 'dev-password';
const BREAK_GLASS_PASSWORD = 'sealed-emergency-password';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.BREAK_GLASS_DEV_PASSWORD = BREAK_GLASS_PASSWORD;
process.env.SESSION_COOKIE_INSECURE = 'true';

let app: INestApplication;
let sales: request.Agent;
let billing: request.Agent;

async function loginAgent(username: string, password: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return agent;
}

function http(): request.Agent {
  return request(app.getHttpServer());
}

function gradeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productFamily: 'newsprint',
    code: 'E2E 36# Test Sheet',
    basisWeightLb: '36.0000',
    paperCostPerTonne: '860.0000',
    footages: [
      { variant: 'long', label: 'Long roll', feetPerRoll: '1340.0000' },
      { variant: 'short', label: 'Short roll', feetPerRoll: '1050.0000' },
    ],
    ...overrides,
  };
}

async function createGrade(
  agent: request.Agent,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> {
  return agent.post('/quoting/grades').send(gradeBody(overrides));
}

async function reload(id: string, family: string): Promise<Record<string, unknown> | undefined> {
  const listed = await sales.get('/quoting/grades').query({ family });
  expect(listed.status).toBe(200);
  return (listed.body.items as Record<string, unknown>[]).find((g) => g.id === id);
}

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { AdminModule } = await import('../src/admin/admin.module');
  const { CrmModule } = await import('../src/crm/crm.module');
  const { QuotingModule } = await import('../src/quoting/quoting.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, AdminModule, CrmModule, QuotingModule],
  }).compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');

  const admin = await loginAgent('break-glass', BREAK_GLASS_PASSWORD);
  for (const [username, roles] of [
    ['dev-sales', ['Sales']],
    ['dev-billing', ['Billing']],
  ] as const) {
    const grant = await admin.put(`/admin/users/local:${username}/roles`).send({
      identity: { externalId: `local:${username}`, username, displayName: username },
      roles,
    });
    expect(grant.status).toBe(200);
  }

  sales = await loginAgent('dev-sales', DEV_PASSWORD);
  billing = await loginAgent('dev-billing', DEV_PASSWORD);
});

afterAll(async () => {
  await app.close();
});

describe('Grade admin edge — authentication', () => {
  it('rejects an anonymous write', async () => {
    expect((await http().post('/quoting/grades').send(gradeBody())).status).toBe(401);
    expect(
      (
        await http()
          .patch('/quoting/grades/00000000-0000-4000-8000-000000000000')
          .send({ code: 'x' })
      ).status,
    ).toBe(401);
  });
});

describe('Grade admin edge — authorization', () => {
  it('refuses Sales and admits Billing — pricing masters are the Billing Manager’s', async () => {
    expect((await createGrade(sales, { code: 'E2E FORBIDDEN' })).status).toBe(403);
    expect(
      (
        await sales
          .patch('/quoting/grades/00000000-0000-4000-8000-000000000000')
          .send({ code: 'x' })
      ).status,
    ).toBe(403);

    const created = await createGrade(billing, { code: 'E2E ALLOWED' });
    expect(created.status).toBe(201);
    expect(
      (
        await billing
          .patch(`/quoting/grades/${created.body.id}`)
          .send({ lockVersion: created.body.lockVersion })
      ).status,
    ).toBe(200);
  });
});

describe('Grade admin edge — create', () => {
  it('returns the grade with its footages, and it then appears in the catalog', async () => {
    const created = await createGrade(billing, { code: 'E2E CREATE' });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.productFamily).toBe('newsprint');
    expect(created.body.code).toBe('E2E CREATE');
    expect(created.body.footages.map((f: { variant: string }) => f.variant).sort()).toEqual([
      'long',
      'short',
    ]);

    expect(created.body.reamAreaDivisor).toBe('432.0000');

    const listed = await reload(created.body.id, 'newsprint');
    expect(listed?.code).toBe('E2E CREATE');
  });

  it('409s a code the family already holds, naming both halves of the key', async () => {
    expect((await createGrade(billing, { code: 'E2E DUP' })).status).toBe(201);
    const again = await createGrade(billing, { code: 'E2E DUP' });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('duplicate-grade-code');
    expect(again.body.productFamily).toBe('newsprint');
    expect(again.body.code).toBe('E2E DUP');
  });

  it('accepts the same code in another family — identity is (family, code)', async () => {
    expect((await createGrade(billing, { code: 'E2E SHARED' })).status).toBe(201);
    expect(
      (await createGrade(billing, { code: 'E2E SHARED', productFamily: 'butcher' })).status,
    ).toBe(201);
  });

  it('422s a payload naming the same footage variant twice', async () => {
    const response = await createGrade(billing, {
      code: 'E2E VARIANT',
      footages: [
        { variant: 'long', label: 'Long roll', feetPerRoll: '1640.0000' },
        { variant: 'long', label: 'Long roll again', feetPerRoll: '1050.0000' },
      ],
    });

    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('duplicate-footage-variant');
    expect(response.body.variant).toBe('long');
  });

  it('400s a malformed body', async () => {
    expect((await billing.post('/quoting/grades').send({})).status).toBe(400);
    expect((await createGrade(billing, { productFamily: 'vellum' })).status).toBe(400);

    expect((await createGrade(billing, { code: 'E2E NUM', paperCostPerTonne: 860 })).status).toBe(
      400,
    );
  });

  it('400s a figure that is wider than its column, rather than 500ing', async () => {
    expect(
      (await createGrade(billing, { code: 'E2E WIDE BW', basisWeightLb: '100000000' })).status,
    ).toBe(400);
    expect(
      (await createGrade(billing, { code: 'E2E WIDE COST', paperCostPerTonne: '1000000000000000' }))
        .status,
    ).toBe(400);

    const refused = await createGrade(billing, {
      code: 'E2E WIDE FT',
      footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '100000000' }],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.fieldErrors.footages).toBeDefined();

    expect(
      (await createGrade(billing, { code: 'E2E AT CEILING', basisWeightLb: '99999999.9999' }))
        .status,
    ).toBe(201);
  });

  it('400s a figure that is well-formed but not positive', async () => {
    expect((await createGrade(billing, { code: 'E2E ZERO', reamAreaDivisor: '0' })).status).toBe(
      400,
    );
    expect(
      (await createGrade(billing, { code: 'E2E NEG', basisWeightLb: '-36.0000' })).status,
    ).toBe(400);
    expect(
      (await createGrade(billing, { code: 'E2E FREE', paperCostPerTonne: '0.0000' })).status,
    ).toBe(400);
    expect(
      (
        await createGrade(billing, {
          code: 'E2E ZERO FT',
          footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '0' }],
        })
      ).status,
    ).toBe(400);

    const listed = await sales.get('/quoting/grades').query({ family: 'newsprint' });
    const codes = (listed.body.items as { code: string }[]).map((g) => g.code);
    expect(codes).not.toContain('E2E ZERO');
    expect(codes).not.toContain('E2E NEG');
  });
});

describe('Grade admin edge — patch', () => {
  it('updates code, basis weight, paper cost and footages', async () => {
    const created = await createGrade(billing, { code: 'E2E PATCH' });
    expect(created.status).toBe(201);

    const patched = await billing.patch(`/quoting/grades/${created.body.id}`).send({
      code: 'E2E PATCHED',
      basisWeightLb: '29.0000',
      paperCostPerTonne: '985.0000',
      footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1820.0000' }],
      lockVersion: created.body.lockVersion,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.code).toBe('E2E PATCHED');
    expect(patched.body.basisWeightLb).toBe('29.0000');
    expect(patched.body.paperCostPerTonne).toBe('985.0000');
    expect(patched.body.updatedAt).not.toBe(created.body.updatedAt);
    expect(patched.body.createdAt).toBe(created.body.createdAt);

    const stored = await reload(created.body.id, 'newsprint');
    expect(stored?.code).toBe('E2E PATCHED');
    expect(stored?.paperCostPerTonne).toBe('985.0000');
  });

  it('persists a ream-area-divisor patch — a bond grade is corrected to 187', async () => {
    const created = await createGrade(billing, {
      productFamily: 'digital_bond',
      code: 'E2E BOND 28#',
      basisWeightLb: '28.0000',
      footages: [{ variant: '500', label: "500' length", feetPerRoll: '500.0000' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.reamAreaDivisor).toBe('432.0000');

    const patched = await billing
      .patch(`/quoting/grades/${created.body.id}`)
      .send({ reamAreaDivisor: '187.0000', lockVersion: created.body.lockVersion });
    expect(patched.status).toBe(200);
    expect(patched.body.reamAreaDivisor).toBe('187.0000');

    const stored = await reload(created.body.id, 'digital_bond');
    expect(stored?.reamAreaDivisor).toBe('187.0000');
  });

  it('replaces the footage set wholesale, so a variant can be removed', async () => {
    const created = await createGrade(billing, { code: 'E2E FOOTAGE' });
    expect(created.body.footages).toHaveLength(2);

    const patched = await billing.patch(`/quoting/grades/${created.body.id}`).send({
      footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1640.0000' }],
      lockVersion: created.body.lockVersion,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.footages.map((f: { variant: string }) => f.variant)).toEqual(['long']);

    const stored = await reload(created.body.id, 'newsprint');
    expect((stored?.footages as { variant: string }[]).map((f) => f.variant)).toEqual(['long']);
  });

  it('409s a rename onto a code the family already holds', async () => {
    expect((await createGrade(billing, { code: 'E2E RENAME A' })).status).toBe(201);
    const other = await createGrade(billing, { code: 'E2E RENAME B' });
    expect(other.status).toBe(201);

    const collided = await billing
      .patch(`/quoting/grades/${other.body.id}`)
      .send({ code: 'E2E RENAME A', lockVersion: other.body.lockVersion });
    expect(collided.status).toBe(409);
    expect(collided.body.reason).toBe('duplicate-grade-code');
    expect(collided.body.code).toBe('E2E RENAME A');
  });

  it('422s a patch naming the same footage variant twice', async () => {
    const created = await createGrade(billing, { code: 'E2E PATCH VARIANT' });
    const response = await billing.patch(`/quoting/grades/${created.body.id}`).send({
      footages: [
        { variant: 'short', label: 'Short roll', feetPerRoll: '1050.0000' },
        { variant: 'short', label: 'Short roll again', feetPerRoll: '1235.0000' },
      ],
      lockVersion: created.body.lockVersion,
    });
    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('duplicate-footage-variant');
    expect(response.body.variant).toBe('short');
  });

  it('400s a non-positive figure, and leaves the stored grade alone', async () => {
    const created = await createGrade(billing, { code: 'E2E PATCH ZERO' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    for (const bad of [
      { reamAreaDivisor: '0' },
      { reamAreaDivisor: '-432.0000' },
      { basisWeightLb: '0.0000' },
      { paperCostPerTonne: '-860.0000' },
      { footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '0' }] },
    ]) {
      expect(
        (
          await billing
            .patch(`/quoting/grades/${id}`)
            .send({ ...bad, lockVersion: created.body.lockVersion })
        ).status,
      ).toBe(400);
    }

    const stored = await reload(id, 'newsprint');
    expect(stored?.reamAreaDivisor).toBe('432.0000');
    expect(stored?.basisWeightLb).toBe('36.0000');
    expect((stored?.footages as { variant: string }[]).map((f) => f.variant).sort()).toEqual([
      'long',
      'short',
    ]);
  });

  it('404s an unknown id and 400s a malformed patch body', async () => {
    expect(
      (
        await billing
          .patch('/quoting/grades/00000000-0000-4000-8000-000000000000')
          .send({ code: 'x', lockVersion: 1 })
      ).status,
    ).toBe(404);
    expect(
      (
        await billing
          .patch('/quoting/grades/00000000-0000-4000-8000-000000000000')
          .send({ basisWeightLb: 36, lockVersion: 1 })
      ).status,
    ).toBe(400);
  });

  it('400s a patch that carries no lockVersion at all', async () => {
    const created = await createGrade(billing, { code: 'E2E NO TOKEN' });
    expect(created.status).toBe(201);
    expect(
      (await billing.patch(`/quoting/grades/${created.body.id}`).send({ code: 'E2E MOVED' }))
        .status,
    ).toBe(400);

    expect((await reload(created.body.id, 'newsprint'))?.code).toBe('E2E NO TOKEN');
  });

  it('409s a stale patch and leaves the earlier correction standing', async () => {
    const created = await createGrade(billing, {
      code: 'E2E STALE',
      paperCostPerTonne: '1000.0000',
    });
    expect(created.status).toBe(201);
    const staleToken = created.body.lockVersion;

    const a = await billing
      .patch(`/quoting/grades/${created.body.id}`)
      .send({ paperCostPerTonne: '1470.0000', lockVersion: staleToken });
    expect(a.status).toBe(200);
    expect(a.body.lockVersion).toBe(staleToken + 1);

    const b = await billing
      .patch(`/quoting/grades/${created.body.id}`)
      .send({ paperCostPerTonne: '1000.0000', lockVersion: staleToken });
    expect(b.status).toBe(409);
    expect(b.body.reason).toBe('stale-aggregate');

    expect(b.body.value).toEqual({ expected: staleToken, actual: staleToken + 1 });

    expect((await reload(created.body.id, 'newsprint'))?.paperCostPerTonne).toBe('1470.0000');

    const retry = await billing
      .patch(`/quoting/grades/${created.body.id}`)
      .send({ paperCostPerTonne: '1315.0000', lockVersion: a.body.lockVersion });
    expect(retry.status).toBe(200);
    expect(retry.body.paperCostPerTonne).toBe('1315.0000');
  });
});

describe('Grade admin edge — stock widths', () => {
  it("starts a grade that names no widths on its family's pallet fits", async () => {
    const created = await createGrade(billing, { code: 'E2E widths default' });
    expect(created.status).toBe(201);

    const fits = await sales.get('/quoting/pallet-fits').query({ family: 'newsprint' });
    expect(created.body.widths).toEqual(
      (fits.body.items as { rollWidthIn: number; rollsPerPallet: number }[]).map((fit) => ({
        rollWidthIn: fit.rollWidthIn,
        rollsPerPallet: fit.rollsPerPallet,
      })),
    );
  });

  it('stores the widths it is given, and replaces them wholesale on PATCH', async () => {
    const created = await createGrade(billing, {
      code: 'E2E widths given',
      widths: [
        { rollWidthIn: 24, rollsPerPallet: 40 },
        { rollWidthIn: 12, rollsPerPallet: 80 },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.widths).toEqual([
      { rollWidthIn: 12, rollsPerPallet: 80 },
      { rollWidthIn: 24, rollsPerPallet: 40 },
    ]);

    const patched = await billing.patch(`/quoting/grades/${created.body.id}`).send({
      widths: [{ rollWidthIn: 17, rollsPerPallet: 60 }],
      lockVersion: created.body.lockVersion,
    });
    expect(patched.status).toBe(200);
    expect((await reload(created.body.id, 'newsprint'))?.['widths']).toEqual([
      { rollWidthIn: 17, rollsPerPallet: 60 },
    ]);
  });

  it('takes a width with no count, returns it as null, and takes the count later', async () => {
    const created = await createGrade(billing, {
      code: 'E2E widths uncounted',
      widths: [{ rollWidthIn: 24, rollsPerPallet: 40 }, { rollWidthIn: 9 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.widths).toEqual([
      { rollWidthIn: 9, rollsPerPallet: null },
      { rollWidthIn: 24, rollsPerPallet: 40 },
    ]);

    const patched = await billing.patch(`/quoting/grades/${created.body.id}`).send({
      widths: [
        { rollWidthIn: 9, rollsPerPallet: null },
        { rollWidthIn: 24, rollsPerPallet: 40 },
        { rollWidthIn: 11, rollsPerPallet: null },
      ],
      lockVersion: created.body.lockVersion,
    });
    expect(patched.status).toBe(200);
    expect((await reload(created.body.id, 'newsprint'))?.['widths']).toEqual([
      { rollWidthIn: 9, rollsPerPallet: null },
      { rollWidthIn: 11, rollsPerPallet: null },
      { rollWidthIn: 24, rollsPerPallet: 40 },
    ]);

    const counted = await billing.patch(`/quoting/grades/${created.body.id}`).send({
      widths: [
        { rollWidthIn: 9, rollsPerPallet: 120 },
        { rollWidthIn: 24, rollsPerPallet: 40 },
      ],
      lockVersion: patched.body.lockVersion,
    });
    expect(counted.status).toBe(200);
    expect(counted.body.widths).toEqual([
      { rollWidthIn: 9, rollsPerPallet: 120 },
      { rollWidthIn: 24, rollsPerPallet: 40 },
    ]);
  });

  it('refuses a count of zero or less', async () => {
    for (const rollsPerPallet of [0, -5]) {
      const response = await createGrade(billing, {
        code: `E2E widths count ${String(rollsPerPallet)}`,
        widths: [{ rollWidthIn: 9, rollsPerPallet }],
      });
      expect(response.status).toBe(400);
    }
  });

  it('takes widths in sixteenths, narrowest first, and gives each back as its number', async () => {
    const created = await createGrade(billing, {
      code: 'E2E widths sixteenths',
      widths: [{ rollWidthIn: 11.3125 }, { rollWidthIn: 9.75 }, { rollWidthIn: 4.625 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.widths).toEqual([
      { rollWidthIn: 4.625, rollsPerPallet: null },
      { rollWidthIn: 9.75, rollsPerPallet: null },
      { rollWidthIn: 11.3125, rollsPerPallet: null },
    ]);
    expect((await reload(created.body.id, 'newsprint'))?.['widths']).toEqual(created.body.widths);
  });

  it('refuses a width that is not a sixteenth, with the sentence that says what one is', async () => {
    const response = await createGrade(billing, {
      code: 'E2E widths 13.7',
      widths: [{ rollWidthIn: 13.7 }],
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(
      'a width is whole inches or sixteenths of an inch, from 1 to 1000 (11 5/16 is 11.3125)',
    );
  });

  it('refuses a width listed twice', async () => {
    const response = await createGrade(billing, {
      code: 'E2E widths twice',
      widths: [
        { rollWidthIn: 17, rollsPerPallet: 60 },
        { rollWidthIn: 17, rollsPerPallet: 50 },
      ],
    });
    expect(response.status).toBe(422);
    expect(response.body.reason).toBe('duplicate-stock-width');
  });
});
