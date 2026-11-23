// Quoting's reference data: paper grades, pallet fits, pricing tiers and the pricing configuration.
// Reads are open. Writes are gated to `PRICING_CONFIG_WRITE_ROLES`, the Billing Manager's: docs/product/roles.md.
// A stale grade write is answered 409: docs/decisions/006-optimistic-concurrency.md.
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DuplicateFootageVariantError,
  DuplicateGradeCodeError,
  DuplicateStockWidthError,
  StockWidthInUseError,
  DuplicateTierCodeError,
  DuplicateTierThresholdError,
  FootageVariantInUseError,
  NoZeroThresholdTierError,
  StaleAggregateError,
  GradeService,
  PricingConfigService,
  PricingTierService,
  RollCostService,
} from '@erp/quoting';
import {
  createGradeRequestSchema,
  createPricingTierRequestSchema,
  gradeListResponseSchema,
  gradeSchema,
  palletFitListResponseSchema,
  pricingConfigHistoryResponseSchema,
  pricingConfigSchema,
  PRICING_CONFIG_WRITE_ROLES,
  pricingTierHistoryResponseSchema,
  pricingTierListResponseSchema,
  pricingTierSchema,
  productFamilySchema,
  refusalBody,
  updatePricingConfigRequestSchema,
  updateGradeRequestSchema,
  updatePricingTierRequestSchema,
  type Grade,
  type GradeListResponse,
  type PalletFitListResponse,
  type PricingConfig,
  type PricingConfigHistoryResponse,
  type PricingTier,
  type PricingTierHistoryResponse,
  type PricingTierListResponse,
  type ProductFamily,
} from '@erp/types';

import { Authenticated, RequireRoles } from '../auth/authz.decorators';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { UuidParam } from '../params.decorators';

function mapGradeError(err: unknown): never {
  if (err instanceof DuplicateGradeCodeError) {
    throw new ConflictException({
      reason: 'duplicate-grade-code',
      productFamily: err.productFamily,
      code: err.code,
    });
  }
  if (err instanceof DuplicateFootageVariantError) {
    throw new UnprocessableEntityException({
      reason: 'duplicate-footage-variant',
      variant: err.variant,
    });
  }
  if (err instanceof FootageVariantInUseError) {
    throw new ConflictException({
      reason: 'footage-variant-in-use',
      variant: err.variant,
      lines: [...err.lines],
    });
  }

  if (err instanceof DuplicateStockWidthError) {
    throw new UnprocessableEntityException({
      reason: 'duplicate-stock-width',
      rollWidthIn: err.rollWidthIn,
    });
  }
  if (err instanceof StockWidthInUseError) {
    throw new ConflictException({
      reason: 'stock-width-in-use',
      rollWidthIn: err.rollWidthIn,
      lines: [...err.lines],
    });
  }

  if (err instanceof StaleAggregateError) {
    throw new ConflictException({
      reason: 'stale-aggregate',
      value: { expected: err.expected, actual: err.actual },
    });
  }
  throw err;
}

function mapTierError(err: unknown): never {
  if (err instanceof DuplicateTierCodeError) {
    throw new ConflictException({ reason: 'duplicate-tier-code', code: err.code });
  }
  if (err instanceof DuplicateTierThresholdError) {
    throw new ConflictException({
      reason: 'duplicate-tier-threshold',
      minPallets: err.minPallets,
    });
  }
  if (err instanceof NoZeroThresholdTierError) {
    throw new UnprocessableEntityException({ reason: 'no-zero-threshold-tier' });
  }
  throw err;
}

@Controller('quoting')
export class CatalogController {
  constructor(
    @Inject(GradeService) private readonly grades: GradeService,
    @Inject(RollCostService) private readonly rollCost: RollCostService,
    @Inject(PricingTierService) private readonly tiers: PricingTierService,
    @Inject(PricingConfigService) private readonly config: PricingConfigService,
  ) {}

  @Authenticated()
  @Get('grades')
  async listGrades(@Query('family') family?: string): Promise<GradeListResponse> {
    let productFamily: ProductFamily | undefined;
    if (family !== undefined) {
      const parsed = productFamilySchema.safeParse(family);
      if (!parsed.success) {
        throw new BadRequestException(refusalBody(parsed.error));
      }
      productFamily = parsed.data;
    }
    const items = await this.grades.list(productFamily);
    return gradeListResponseSchema.parse({ items: [...items] });
  }

  @RequireRoles(...PRICING_CONFIG_WRITE_ROLES)
  @Post('grades')
  async createGrade(@Body() body: unknown): Promise<Grade> {
    const parsed = createGradeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      return gradeSchema.parse(await this.grades.create(parsed.data));
    } catch (err) {
      mapGradeError(err);
    }
  }

  @RequireRoles(...PRICING_CONFIG_WRITE_ROLES)
  @Patch('grades/:id')
  async updateGrade(@UuidParam('id') id: string, @Body() body: unknown): Promise<Grade> {
    const parsed = updateGradeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const updated = await this.grades.update(id, parsed.data);
      if (updated === null) {
        throw new NotFoundException();
      }
      return gradeSchema.parse(updated);
    } catch (err) {
      mapGradeError(err);
    }
  }

  @Authenticated()
  @Get('pallet-fits')
  async listPalletFits(@Query('family') family?: string): Promise<PalletFitListResponse> {
    const parsed = productFamilySchema.safeParse(family);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    const items = await this.rollCost.listPalletFits(parsed.data);
    return palletFitListResponseSchema.parse({ items: [...items] });
  }

  @Authenticated()
  @Get('tiers')
  async listTiers(): Promise<PricingTierListResponse> {
    const items = await this.tiers.list();
    return pricingTierListResponseSchema.parse({ items: [...items] });
  }

  @Authenticated()
  @Get('tiers/history')
  async getTierHistory(): Promise<PricingTierHistoryResponse> {
    const items = await this.tiers.history();
    return pricingTierHistoryResponseSchema.parse({ items: [...items] });
  }

  @RequireRoles(...PRICING_CONFIG_WRITE_ROLES)
  @Post('tiers')
  async createTier(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<PricingTier> {
    const parsed = createPricingTierRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    try {
      return pricingTierSchema.parse(
        await this.tiers.create(parsed.data, request.erpUser.username),
      );
    } catch (err) {
      mapTierError(err);
    }
  }

  @RequireRoles(...PRICING_CONFIG_WRITE_ROLES)
  @Patch('tiers/:code')
  async updateTier(
    // Not `UuidParam`: a tier is addressed by its code. apps/api/test/every-id-param-is-a-uuid.test.ts lists it.
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<PricingTier> {
    const parsed = updatePricingTierRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    try {
      const updated = await this.tiers.update(code, parsed.data, request.erpUser.username);
      if (updated === null) {
        throw new NotFoundException();
      }
      return pricingTierSchema.parse(updated);
    } catch (err) {
      mapTierError(err);
    }
  }

  @Authenticated()
  @Get('config')
  async getConfig(): Promise<PricingConfig> {
    return pricingConfigSchema.parse(await this.config.get());
  }

  @Authenticated()
  @Get('config/history')
  async getConfigHistory(): Promise<PricingConfigHistoryResponse> {
    const items = await this.config.history();
    return pricingConfigHistoryResponseSchema.parse({ items: [...items] });
  }

  @RequireRoles(...PRICING_CONFIG_WRITE_ROLES)
  @Patch('config')
  async updateConfig(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<PricingConfig> {
    const parsed = updatePricingConfigRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    return pricingConfigSchema.parse(
      await this.config.update(parsed.data, request.erpUser.username),
    );
  }
}
