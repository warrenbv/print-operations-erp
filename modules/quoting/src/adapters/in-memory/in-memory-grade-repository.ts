// The in-memory adapter for `GradeRepository`, used when the API runs on in-memory storage and by
// the unit tests. It and the Drizzle adapter are held to
// modules/quoting/test/contracts/grade-repository.contract.ts.
import type { Grade, GradeFootage, GradeWidth, ProductFamily } from '@erp/types';

import {
  DuplicateGradeCodeError,
  type GradeListParams,
  type GradePatch,
  type GradeRepository,
  type NewGrade,
  StaleAggregateError,
} from '../../ports';
import { DEFAULT_PALLET_FITS } from './in-memory-pallet-fit-repository';

interface Row {
  id: string;
  productFamily: ProductFamily;
  code: string;
  basisWeightLb: string;
  reamAreaDivisor: string;
  paperCostPerTonne: string;
  footages: readonly GradeFootage[];
  widths: readonly GradeWidth[];
  lockVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

function sortFootages(footages: readonly GradeFootage[]): GradeFootage[] {
  return [...footages].sort((a, b) => a.variant.localeCompare(b.variant));
}

function sortWidths(widths: readonly GradeWidth[]): GradeWidth[] {
  return [...widths].sort((a, b) => a.rollWidthIn - b.rollWidthIn);
}

function familyWidths(productFamily: ProductFamily): GradeWidth[] {
  return DEFAULT_PALLET_FITS.filter((fit) => fit.productFamily === productFamily).map((fit) => ({
    rollWidthIn: fit.rollWidthIn,
    rollsPerPallet: fit.rollsPerPallet,
  }));
}

const EPOCH = new Date(0).toISOString();

// Fixed ids, so the browser journey in tests/portfolio/quote-to-order.spec.ts can pick a grade.
export const DEFAULT_GRADE_IDS = {
  kraft30: '01988a00-0005-7000-8000-000000000001',
  kraft50: '01988a00-0005-7000-8000-000000000002',
  butcher40: '01988a00-0005-7000-8000-000000000003',
  newsprint277: '01988a00-0005-7000-8000-000000000004',
  bond20: '01988a00-0005-7000-8000-000000000005',
} as const;

// Fictional grades the API seeds when it runs on in-memory storage. The baseline migration seeds
// none.
export const DEFAULT_GRADES: readonly Grade[] = [
  {
    id: DEFAULT_GRADE_IDS.kraft30,
    productFamily: 'kraft',
    code: '30#',
    basisWeightLb: '30.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '1060.0000',
    footages: [
      { variant: 'long', label: 'Long roll', feetPerRoll: '1250.0000' },
      { variant: 'short', label: 'Short roll', feetPerRoll: '925.0000' },
    ],
    widths: familyWidths('kraft'),
    lockVersion: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: DEFAULT_GRADE_IDS.kraft50,
    productFamily: 'kraft',
    code: '50#',
    basisWeightLb: '50.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '1110.0000',
    footages: [
      { variant: 'long', label: 'Long roll', feetPerRoll: '1050.0000' },
      { variant: 'short', label: 'Short roll', feetPerRoll: '780.0000' },
    ],
    widths: familyWidths('kraft'),
    lockVersion: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: DEFAULT_GRADE_IDS.butcher40,
    productFamily: 'butcher',
    code: '40#',
    basisWeightLb: '40.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '1940.0000',
    footages: [
      { variant: 'long', label: 'Long roll', feetPerRoll: '1150.0000' },
      { variant: 'short', label: 'Short roll', feetPerRoll: '820.0000' },
    ],
    widths: familyWidths('butcher'),
    lockVersion: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: DEFAULT_GRADE_IDS.newsprint277,
    productFamily: 'newsprint',
    code: '27.7#',
    basisWeightLb: '27.7000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '940.0000',
    footages: [
      { variant: 'long', label: 'Long roll', feetPerRoll: '1320.0000' },
      { variant: 'short', label: 'Short roll', feetPerRoll: '980.0000' },
    ],
    widths: familyWidths('newsprint'),
    lockVersion: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: DEFAULT_GRADE_IDS.bond20,
    productFamily: 'digital_bond',
    code: '20#',
    basisWeightLb: '20.0000',

    reamAreaDivisor: '187.0000',
    paperCostPerTonne: '2850.0000',
    footages: [
      { variant: '450', label: "450' length", feetPerRoll: '450.0000' },
      { variant: '125', label: "125' length", feetPerRoll: '125.0000' },
    ],
    widths: familyWidths('digital_bond'),
    lockVersion: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
];

function toGrade(row: Row): Grade {
  return {
    id: row.id,
    productFamily: row.productFamily,
    code: row.code,
    basisWeightLb: row.basisWeightLb,
    reamAreaDivisor: row.reamAreaDivisor,
    paperCostPerTonne: row.paperCostPerTonne,
    footages: sortFootages(row.footages),
    widths: sortWidths(row.widths),
    lockVersion: row.lockVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class InMemoryGradeRepository implements GradeRepository {
  readonly #byId = new Map<string, Row>();

  constructor(seed: readonly Grade[] = []) {
    for (const g of seed) {
      this.#byId.set(g.id, {
        id: g.id,
        productFamily: g.productFamily,
        code: g.code,
        basisWeightLb: g.basisWeightLb,
        reamAreaDivisor: g.reamAreaDivisor,
        paperCostPerTonne: g.paperCostPerTonne,
        footages: g.footages,
        widths: g.widths,
        lockVersion: g.lockVersion,
        createdAt: new Date(g.createdAt),
        updatedAt: new Date(g.updatedAt),
      });
    }
  }

  async create(input: NewGrade & { id: string; createdAt: Date; updatedAt: Date }): Promise<Grade> {
    this.#assertCodeFree(input.productFamily, input.code, null);
    const row: Row = {
      id: input.id,
      productFamily: input.productFamily,
      code: input.code,
      basisWeightLb: input.basisWeightLb,
      reamAreaDivisor: input.reamAreaDivisor,
      paperCostPerTonne: input.paperCostPerTonne,
      footages: input.footages,
      widths: input.widths ?? [],

      lockVersion: 1,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
    this.#byId.set(row.id, row);
    return toGrade(row);
  }

  async findById(id: string): Promise<Grade | null> {
    const row = this.#byId.get(id);
    return row === undefined ? null : toGrade(row);
  }

  async list(params: GradeListParams): Promise<readonly Grade[]> {
    const rows = [...this.#byId.values()].filter(
      (r) => params.productFamily === undefined || r.productFamily === params.productFamily,
    );
    rows.sort((a, b) =>
      a.productFamily === b.productFamily
        ? a.code.localeCompare(b.code)
        : a.productFamily.localeCompare(b.productFamily),
    );
    return rows.map(toGrade);
  }

  async update(
    id: string,
    patch: GradePatch,
    updatedAt: Date,
    expectedLockVersion?: number,
  ): Promise<Grade | null> {
    const existing = this.#byId.get(id);
    if (existing === undefined) {
      return null;
    }

    // A patch that changes nothing returns the grade without bumping `lockVersion`, as the Drizzle
    // adapter does.
    const hasChange =
      patch.code !== undefined ||
      patch.basisWeightLb !== undefined ||
      patch.reamAreaDivisor !== undefined ||
      patch.paperCostPerTonne !== undefined ||
      patch.footages !== undefined ||
      patch.widths !== undefined;
    if (!hasChange) {
      return toGrade(existing);
    }

    if (expectedLockVersion !== undefined && existing.lockVersion !== expectedLockVersion) {
      throw new StaleAggregateError('grade', id, expectedLockVersion, existing.lockVersion);
    }
    if (patch.code !== undefined && patch.code !== existing.code) {
      this.#assertCodeFree(existing.productFamily, patch.code, id);
    }
    const next: Row = {
      ...existing,
      ...(patch.code === undefined ? {} : { code: patch.code }),
      ...(patch.basisWeightLb === undefined ? {} : { basisWeightLb: patch.basisWeightLb }),
      ...(patch.reamAreaDivisor === undefined ? {} : { reamAreaDivisor: patch.reamAreaDivisor }),
      ...(patch.paperCostPerTonne === undefined
        ? {}
        : { paperCostPerTonne: patch.paperCostPerTonne }),
      ...(patch.footages === undefined ? {} : { footages: patch.footages }),
      ...(patch.widths === undefined ? {} : { widths: patch.widths }),

      lockVersion: existing.lockVersion + 1,
      updatedAt,
    };
    this.#byId.set(id, next);
    return toGrade(next);
  }

  #assertCodeFree(productFamily: string, code: string, exceptId: string | null): void {
    for (const [id, row] of this.#byId) {
      if (id !== exceptId && row.productFamily === productFamily && row.code === code) {
        throw new DuplicateGradeCodeError(productFamily, code);
      }
    }
  }
}
