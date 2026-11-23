// The PostgreSQL adapter for `GradeRepository` in modules/quoting/src/ports.ts, held with the
// in-memory adapter to modules/quoting/test/contracts/grade-repository.contract.ts.
import { isUniqueViolation, newId } from '@erp/db';
import type { Grade, GradeFootage, GradeWidth, ProductFamily } from '@erp/types';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { QuotingDb } from '../../data/quoting-db';
import { gradeFootages, grades, gradeWidths } from '../../data/schema';
import {
  DuplicateGradeCodeError,
  type GradeListParams,
  type GradePatch,
  type GradeRepository,
  type NewGrade,
  StaleAggregateError,
} from '../../ports';

type GradeRow = typeof grades.$inferSelect;
type FootageRow = typeof gradeFootages.$inferSelect;
type WidthRow = typeof gradeWidths.$inferSelect;

function toFootage(row: FootageRow): GradeFootage {
  return { variant: row.variant, label: row.label, feetPerRoll: row.feetPerRoll };
}

function toWidth(row: WidthRow): GradeWidth {
  return { rollWidthIn: row.rollWidthIn, rollsPerPallet: row.rollsPerPallet };
}

function toGrade(
  row: GradeRow,
  footages: readonly FootageRow[],
  widths: readonly WidthRow[],
): Grade {
  return {
    id: row.id,

    productFamily: row.productFamily as ProductFamily,
    code: row.code,
    basisWeightLb: row.basisWeightLb,
    reamAreaDivisor: row.reamAreaDivisor,
    paperCostPerTonne: row.paperCostPerTonne,
    footages: footages.map(toFootage),
    widths: widths.map(toWidth),
    lockVersion: row.lockVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleGradeRepository implements GradeRepository {
  readonly #db: QuotingDb;

  constructor(db: QuotingDb) {
    this.#db = db;
  }

  async create(input: NewGrade & { id: string; createdAt: Date; updatedAt: Date }): Promise<Grade> {
    try {
      return await this.#db.transaction(async (tx) => {
        const [row] = await tx
          .insert(grades)
          .values({
            id: input.id,
            productFamily: input.productFamily,
            code: input.code,
            basisWeightLb: input.basisWeightLb,
            reamAreaDivisor: input.reamAreaDivisor,
            paperCostPerTonne: input.paperCostPerTonne,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          })
          .returning();
        if (row === undefined) {
          throw new Error('Creating a grade returned no row');
        }
        const footages = await this.#replaceFootages(tx, input.id, input.footages, input.updatedAt);
        const widths = await this.#replaceWidths(tx, input.id, input.widths ?? [], input.updatedAt);
        return toGrade(row, footages, widths);
      });
    } catch (err) {
      // The service refuses duplicate footages and widths before this call, so a unique violation
      // here is the grade code.
      if (isUniqueViolation(err)) {
        throw new DuplicateGradeCodeError(input.productFamily, input.code);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<Grade | null> {
    const [row] = await this.#db.select().from(grades).where(eq(grades.id, id)).limit(1);
    if (row === undefined) {
      return null;
    }
    const footages = await this.#db
      .select()
      .from(gradeFootages)
      .where(eq(gradeFootages.gradeId, id))
      .orderBy(asc(gradeFootages.variant));
    const widths = await this.#db
      .select()
      .from(gradeWidths)
      .where(eq(gradeWidths.gradeId, id))
      .orderBy(asc(gradeWidths.rollWidthIn));
    return toGrade(row, footages, widths);
  }

  async list(params: GradeListParams): Promise<readonly Grade[]> {
    const base = this.#db
      .select()
      .from(grades)
      .orderBy(asc(grades.productFamily), asc(grades.code));
    const rows =
      params.productFamily === undefined
        ? await base
        : await base.where(eq(grades.productFamily, params.productFamily));
    if (rows.length === 0) {
      return [];
    }

    const footageRows = await this.#db
      .select()
      .from(gradeFootages)
      .where(
        inArray(
          gradeFootages.gradeId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(gradeFootages.variant));

    const widthRows = await this.#db
      .select()
      .from(gradeWidths)
      .where(
        inArray(
          gradeWidths.gradeId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(gradeWidths.rollWidthIn));

    const byGrade = groupByGrade(footageRows);
    const widthsByGrade = groupByGrade(widthRows);
    return rows.map((r) => toGrade(r, byGrade.get(r.id) ?? [], widthsByGrade.get(r.id) ?? []));
  }

  async update(
    id: string,
    patch: GradePatch,
    updatedAt: Date,
    expectedLockVersion?: number,
  ): Promise<Grade | null> {
    const hasScalarChange =
      patch.code !== undefined ||
      patch.basisWeightLb !== undefined ||
      patch.reamAreaDivisor !== undefined ||
      patch.paperCostPerTonne !== undefined;

    if (!hasScalarChange && patch.footages === undefined && patch.widths === undefined) {
      return this.findById(id);
    }

    const guard =
      expectedLockVersion === undefined
        ? eq(grades.id, id)
        : and(eq(grades.id, id), eq(grades.lockVersion, expectedLockVersion));

    try {
      return await this.#db.transaction(async (tx) => {
        let row: GradeRow | undefined;
        if (hasScalarChange) {
          [row] = await tx
            .update(grades)
            .set({
              ...(patch.code === undefined ? {} : { code: patch.code }),
              ...(patch.basisWeightLb === undefined ? {} : { basisWeightLb: patch.basisWeightLb }),
              ...(patch.reamAreaDivisor === undefined
                ? {}
                : { reamAreaDivisor: patch.reamAreaDivisor }),
              ...(patch.paperCostPerTonne === undefined
                ? {}
                : { paperCostPerTonne: patch.paperCostPerTonne }),
              updatedAt,
              lockVersion: sql`${grades.lockVersion} + 1`,
            })
            .where(guard)
            .returning();
          // A change to footages or widths alone still bumps the grade's `lockVersion`, because
          // they are part of the aggregate: docs/decisions/006-optimistic-concurrency.md.
        } else {
          [row] = await tx
            .update(grades)
            .set({ updatedAt, lockVersion: sql`${grades.lockVersion} + 1` })
            .where(guard)
            .returning();
        }
        if (row === undefined) {
          if (expectedLockVersion !== undefined) {
            const [current] = await tx.select().from(grades).where(eq(grades.id, id));
            if (current !== undefined) {
              throw new StaleAggregateError('grade', id, expectedLockVersion, current.lockVersion);
            }
          }
          return null;
        }

        const footages =
          patch.footages === undefined
            ? await tx
                .select()
                .from(gradeFootages)
                .where(eq(gradeFootages.gradeId, id))
                .orderBy(asc(gradeFootages.variant))
            : await this.#replaceFootages(tx, id, patch.footages, updatedAt);
        const widths =
          patch.widths === undefined
            ? await tx
                .select()
                .from(gradeWidths)
                .where(eq(gradeWidths.gradeId, id))
                .orderBy(asc(gradeWidths.rollWidthIn))
            : await this.#replaceWidths(tx, id, patch.widths, updatedAt);

        return toGrade(row, footages, widths);
      });
    } catch (err) {
      if (isUniqueViolation(err) && patch.code !== undefined) {
        const current = await this.#db
          .select({ family: grades.productFamily })
          .from(grades)
          .where(eq(grades.id, id))
          .limit(1);
        throw new DuplicateGradeCodeError(current[0]?.family ?? 'unknown', patch.code);
      }
      throw err;
    }
  }

  async #replaceFootages(
    tx: Pick<QuotingDb, 'delete' | 'insert'>,
    gradeId: string,
    footages: readonly GradeFootage[],
    now: Date,
  ): Promise<FootageRow[]> {
    await tx.delete(gradeFootages).where(eq(gradeFootages.gradeId, gradeId));
    if (footages.length === 0) {
      return [];
    }
    const inserted = await tx
      .insert(gradeFootages)
      .values(
        footages.map((f) => ({
          id: newId(),
          gradeId,
          variant: f.variant,
          label: f.label,
          feetPerRoll: f.feetPerRoll,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .returning();
    return [...inserted].sort((a, b) => a.variant.localeCompare(b.variant));
  }

  async #replaceWidths(
    tx: Pick<QuotingDb, 'delete' | 'insert'>,
    gradeId: string,
    widths: readonly GradeWidth[],
    now: Date,
  ): Promise<WidthRow[]> {
    await tx.delete(gradeWidths).where(eq(gradeWidths.gradeId, gradeId));
    if (widths.length === 0) {
      return [];
    }
    const inserted = await tx
      .insert(gradeWidths)
      .values(
        widths.map((w) => ({
          id: newId(),
          gradeId,
          rollWidthIn: w.rollWidthIn,
          rollsPerPallet: w.rollsPerPallet,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .returning();
    return [...inserted].sort((a, b) => a.rollWidthIn - b.rollWidthIn);
  }
}

function groupByGrade<T extends { gradeId: string }>(rows: readonly T[]): Map<string, T[]> {
  const byGrade = new Map<string, T[]>();
  for (const r of rows) {
    const list = byGrade.get(r.gradeId);
    if (list === undefined) {
      byGrade.set(r.gradeId, [r]);
    } else {
      list.push(r);
    }
  }
  return byGrade;
}
