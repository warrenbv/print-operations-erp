// Tests the grade master service on in-memory adapters, including the guard that keeps a footage or
// stock width in use on a draft quote. Subject: modules/quoting/src/services/grade-service.ts.
import { newId } from '@erp/db';
import { describe, expect, it } from 'vitest';

import { InMemoryGradeRepository } from '../src/adapters/in-memory/in-memory-grade-repository';
import { InMemoryPalletFitRepository } from '../src/adapters/in-memory/in-memory-pallet-fit-repository';
import { InMemoryQuoteRepository } from '../src/adapters/in-memory/in-memory-quote-repository';
import {
  DuplicateFootageVariantError,
  DuplicateGradeCodeError,
  DuplicateStockWidthError,
  FootageVariantInUseError,
  StockWidthInUseError,
  type QuoteRepository,
} from '../src/ports';
import { GradeService } from '../src/services/grade-service';
import { MutableClock, createGradeRequest } from './fixtures';

function newService(): {
  service: GradeService;
  repo: InMemoryGradeRepository;
  quotes: InMemoryQuoteRepository;
  clock: MutableClock;
} {
  const clock = new MutableClock();
  const repo = new InMemoryGradeRepository();
  const quotes = new InMemoryQuoteRepository();
  const service = new GradeService({
    grades: repo,
    quotes,
    palletFits: new InMemoryPalletFitRepository(),
    clock,
  });
  return { service, repo, quotes, clock };
}

describe('GradeService.create', () => {
  it('mints an id and stamps timestamps from the clock', async () => {
    const { service, clock } = newService();
    const grade = await service.create(createGradeRequest());
    expect(grade.id).toBeTruthy();
    expect(grade.createdAt).toBe(clock.now().toISOString());
    expect(grade.updatedAt).toBe(clock.now().toISOString());
  });

  it('allows the same code in different families — Kraft 40# and Butcher 40# are different grades', async () => {
    const { service } = newService();
    const kraft = await service.create(
      createGradeRequest({ productFamily: 'kraft', code: '40#', paperCostPerTonne: '760' }),
    );
    const butcher = await service.create(
      createGradeRequest({ productFamily: 'butcher', code: '40#', paperCostPerTonne: '1940' }),
    );
    expect(kraft.id).not.toBe(butcher.id);
    expect(kraft.paperCostPerTonne).toBe('760');
    expect(butcher.paperCostPerTonne).toBe('1940');
  });

  it('rejects a duplicate code within one family', async () => {
    const { service } = newService();
    await service.create(createGradeRequest({ productFamily: 'kraft', code: '40#' }));
    await expect(
      service.create(createGradeRequest({ productFamily: 'kraft', code: '40#' })),
    ).rejects.toBeInstanceOf(DuplicateGradeCodeError);
  });

  it('rejects a footage list naming the same variant twice', async () => {
    const { service } = newService();
    await expect(
      service.create(
        createGradeRequest({
          footages: [
            { variant: 'long', label: 'Long roll', feetPerRoll: '1320' },
            { variant: 'long', label: 'Long roll again', feetPerRoll: '1100' },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateFootageVariantError);
  });
});

describe('GradeService.update', () => {
  it('bumps updatedAt while leaving createdAt alone', async () => {
    const { service, clock } = newService();
    const created = await service.create(createGradeRequest());
    clock.advance(60_000);
    const patched = await service.update(created.id, {
      paperCostPerTonne: '965.0000',
      lockVersion: created.lockVersion,
    });
    expect(patched?.paperCostPerTonne).toBe('965.0000');
    expect(patched?.createdAt).toBe(created.createdAt);
    expect(patched?.updatedAt).toBe(clock.now().toISOString());
  });

  it('persists a ream-area-divisor patch — the field a bond grade is corrected on', async () => {
    const { service } = newService();
    const created = await service.create(
      createGradeRequest({ productFamily: 'digital_bond', code: '20#' }),
    );
    expect(created.reamAreaDivisor).toBe('432.0000');

    const patched = await service.update(created.id, {
      reamAreaDivisor: '187.0000',
      lockVersion: created.lockVersion,
    });
    expect(patched?.reamAreaDivisor).toBe('187.0000');
    expect(await service.findById(created.id)).toEqual(patched);
  });

  it('replaces the footage set wholesale, so a variant can be removed', async () => {
    const { service } = newService();
    const created = await service.create(
      createGradeRequest({
        footages: [
          { variant: 'long', label: 'Long roll', feetPerRoll: '1320' },
          { variant: 'short', label: 'Short roll', feetPerRoll: '1100' },
        ],
      }),
    );
    expect(created.footages).toHaveLength(2);

    const patched = await service.update(created.id, {
      footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1320' }],
      lockVersion: created.lockVersion,
    });
    expect(patched?.footages.map((f) => f.variant)).toEqual(['long']);
  });

  it('leaves footages alone when the patch omits them', async () => {
    const { service } = newService();
    const created = await service.create(createGradeRequest());
    const patched = await service.update(created.id, {
      basisWeightLb: '43.0000',
      lockVersion: created.lockVersion,
    });
    expect(patched?.footages).toEqual(created.footages);
  });

  it('returns null for an unknown id, so the edge can 404 without exceptions', async () => {
    const { service } = newService();
    expect(await service.update('does-not-exist', { code: 'x', lockVersion: 1 })).toBeNull();
  });
});

describe('GradeService.list', () => {
  it('filters by family and orders by family then code', async () => {
    const { service } = newService();
    await service.create(createGradeRequest({ productFamily: 'kraft', code: '50#' }));
    await service.create(createGradeRequest({ productFamily: 'kraft', code: '35#' }));
    await service.create(
      createGradeRequest({ productFamily: 'newsprint', code: '34# Test Sheet' }),
    );

    const kraft = await service.list('kraft');
    expect(kraft.map((g) => g.code)).toEqual(['35#', '50#']);

    const all = await service.list();
    expect(all).toHaveLength(3);
    expect(all[0]?.productFamily).toBe('kraft');
  });
});

describe('GradeService.update — the footage-variant referential guard', () => {
  const usage = (
    byVariant: Readonly<Record<string, readonly { quoteId: string; lineNumber: number }[]>>,
  ): QuoteRepository =>
    ({
      async draftLinesUsingGradeVariant(_gradeId: string, variant: string) {
        return byVariant[variant] ?? [];
      },
    }) as unknown as QuoteRepository;

  const serviceWith = (
    byVariant: Readonly<Record<string, readonly { quoteId: string; lineNumber: number }[]>>,
  ) => {
    const clock = new MutableClock();
    const grades = new InMemoryGradeRepository();
    const service = new GradeService({
      grades,
      quotes: usage(byVariant),
      palletFits: new InMemoryPalletFitRepository(),
      clock,
    });
    return { service, grades };
  };

  const twoVariants = [
    { variant: 'long', label: 'Long roll', feetPerRoll: '1500.0000' },
    { variant: 'short', label: 'Short roll', feetPerRoll: '1100.0000' },
  ];

  it('refuses to remove a variant draft lines still use, naming them', async () => {
    const quoteId = newId();
    const { service } = serviceWith({ long: [{ quoteId, lineNumber: 2 }] });
    const grade = await service.create(createGradeRequest({ footages: twoVariants }));

    const attempt = service.update(grade.id, {
      footages: [twoVariants[1]!],
      lockVersion: grade.lockVersion,
    });

    await expect(attempt).rejects.toBeInstanceOf(FootageVariantInUseError);
    await expect(attempt).rejects.toMatchObject({
      variant: 'long',
      lines: [{ quoteId, lineNumber: 2 }],
    });
  });

  it('treats a rename as a removal, because the payload cannot say otherwise', async () => {
    const { service } = serviceWith({ long: [{ quoteId: newId(), lineNumber: 1 }] });
    const grade = await service.create(createGradeRequest({ footages: twoVariants }));

    await expect(
      service.update(grade.id, {
        footages: [
          { variant: 'west', label: 'Long roll', feetPerRoll: '1500.0000' },
          twoVariants[1]!,
        ],
        lockVersion: grade.lockVersion,
      }),
    ).rejects.toBeInstanceOf(FootageVariantInUseError);
  });

  it('allows a patch that keeps every variant, even where lines use them', async () => {
    const { service } = serviceWith({
      long: [{ quoteId: newId(), lineNumber: 1 }],
      short: [{ quoteId: newId(), lineNumber: 1 }],
    });
    const grade = await service.create(createGradeRequest({ footages: twoVariants }));

    const updated = await service.update(grade.id, {
      footages: [{ ...twoVariants[0]!, feetPerRoll: '1580.0000' }, twoVariants[1]!],
      lockVersion: grade.lockVersion,
    });

    expect(updated?.footages.find((f) => f.variant === 'long')?.feetPerRoll).toBe('1580.0000');
  });

  it('allows removing a variant nothing references', async () => {
    const { service } = serviceWith({ short: [{ quoteId: newId(), lineNumber: 1 }] });
    const grade = await service.create(createGradeRequest({ footages: twoVariants }));

    const updated = await service.update(grade.id, {
      footages: [twoVariants[1]!],
      lockVersion: grade.lockVersion,
    });

    expect(updated?.footages.map((f) => f.variant)).toEqual(['short']);
  });

  it('leaves a footage-less patch alone', async () => {
    const { service } = serviceWith({ long: [{ quoteId: newId(), lineNumber: 1 }] });
    const grade = await service.create(createGradeRequest({ footages: twoVariants }));

    const updated = await service.update(grade.id, {
      paperCostPerTonne: '900.0000',
      lockVersion: grade.lockVersion,
    });

    expect(updated?.paperCostPerTonne).toBe('900.0000');
    expect(updated?.footages).toHaveLength(2);
  });

  it('returns null for an unknown grade rather than guessing at its variants', async () => {
    const { service } = serviceWith({ long: [{ quoteId: newId(), lineNumber: 1 }] });
    expect(await service.update(newId(), { footages: twoVariants, lockVersion: 1 })).toBeNull();
  });
});

describe('GradeService stock widths', () => {
  const usingWidths = (
    byWidth: Readonly<Record<number, readonly { quoteId: string; lineNumber: number }[]>>,
  ): QuoteRepository =>
    ({
      async draftLinesUsingGradeWidth(_gradeId: string, rollWidthIn: number) {
        return byWidth[rollWidthIn] ?? [];
      },
    }) as unknown as QuoteRepository;

  const serviceWith = (
    byWidth: Readonly<Record<number, readonly { quoteId: string; lineNumber: number }[]>> = {},
  ) =>
    new GradeService({
      grades: new InMemoryGradeRepository(),
      quotes: usingWidths(byWidth),
      palletFits: new InMemoryPalletFitRepository(),
      clock: new MutableClock(),
    });

  it("starts a new grade on its family's pallet fits when it names no widths", async () => {
    const service = serviceWith();
    const butcher = await service.create(createGradeRequest({ productFamily: 'butcher' }));
    const fits = await new InMemoryPalletFitRepository().list('butcher');

    expect(butcher.widths).toEqual(
      fits.map((fit) => ({ rollWidthIn: fit.rollWidthIn, rollsPerPallet: fit.rollsPerPallet })),
    );
  });

  it('keeps an explicit empty list: a paper stocked in nothing', async () => {
    const grade = await serviceWith().create(createGradeRequest({ widths: [] }));
    expect(grade.widths).toEqual([]);
  });

  it('stores the widths it is given, narrowest first', async () => {
    const grade = await serviceWith().create(
      createGradeRequest({
        widths: [
          { rollWidthIn: 36, rollsPerPallet: 20 },
          { rollWidthIn: 17, rollsPerPallet: 60 },
        ],
      }),
    );
    expect(grade.widths.map((w) => w.rollWidthIn)).toEqual([17, 36]);
  });

  it('refuses a width listed twice', async () => {
    const service = serviceWith();
    await expect(
      service.create(
        createGradeRequest({
          widths: [
            { rollWidthIn: 17, rollsPerPallet: 60 },
            { rollWidthIn: 17, rollsPerPallet: 50 },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateStockWidthError);
  });

  it('refuses to remove a width draft lines still use, naming them', async () => {
    const quoteId = newId();
    const service = serviceWith({ 24: [{ quoteId, lineNumber: 3 }] });
    const grade = await service.create(
      createGradeRequest({
        widths: [
          { rollWidthIn: 12, rollsPerPallet: 75 },
          { rollWidthIn: 24, rollsPerPallet: 50 },
        ],
      }),
    );

    const attempt = service.update(grade.id, {
      widths: [{ rollWidthIn: 12, rollsPerPallet: 75 }],
      lockVersion: grade.lockVersion,
    });

    await expect(attempt).rejects.toBeInstanceOf(StockWidthInUseError);
    await expect(attempt).rejects.toMatchObject({
      rollWidthIn: 24,
      lines: [{ quoteId, lineNumber: 3 }],
    });
  });

  it('lets a used width change its rolls per pallet, which removes nothing', async () => {
    const service = serviceWith({ 24: [{ quoteId: newId(), lineNumber: 1 }] });
    const grade = await service.create(
      createGradeRequest({ widths: [{ rollWidthIn: 24, rollsPerPallet: 50 }] }),
    );

    const patched = await service.update(grade.id, {
      widths: [{ rollWidthIn: 24, rollsPerPallet: 45 }],
      lockVersion: grade.lockVersion,
    });
    expect(patched?.widths).toEqual([{ rollWidthIn: 24, rollsPerPallet: 45 }]);
  });
});
