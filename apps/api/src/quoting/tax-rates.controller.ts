// Imported tax rates. Reading is open, and importing is gated to `TAX_RATE_WRITE_ROLES`.
// Current rates are judged against the business day from apps/api/src/test-clock.ts.
import { TaxRateService } from '@erp/quoting';
import {
  TAX_RATE_WRITE_ROLES,
  businessDayOf,
  importTaxRatesRequestSchema,
  importTaxRatesResponseSchema,
  quarterStartOf,
  refusalBody,
  taxRateListResponseSchema,
  taxRateSummaryListResponseSchema,
  type ImportTaxRatesResponse,
  type TaxRateListResponse,
  type TaxRateSummaryListResponse,
} from '@erp/types';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';

import { Authenticated, RequireRoles } from '../auth/authz.decorators';
import { apiClock } from '../test-clock';

@Controller('quoting/tax-rates')
export class TaxRatesController {
  constructor(@Inject(TaxRateService) private readonly rates: TaxRateService) {}

  @Authenticated()
  @Get()
  async list(): Promise<TaxRateSummaryListResponse> {
    const asOf = businessDayOf(apiClock.now());
    return taxRateSummaryListResponseSchema.parse({
      asOf,
      currentQuarterStart: quarterStartOf(asOf),
      items: await this.rates.currentRates(asOf),
    });
  }

  @Authenticated()
  @Get(':jurisdiction/history')
  // Not `UuidParam`: a jurisdiction is a location code. apps/api/test/every-id-param-is-a-uuid.test.ts lists it.
  async history(@Param('jurisdiction') jurisdiction: string): Promise<TaxRateListResponse> {
    return taxRateListResponseSchema.parse({ items: await this.rates.history(jurisdiction) });
  }

  @RequireRoles(...TAX_RATE_WRITE_ROLES)
  @HttpCode(200)
  @Post('import')
  async import(@Body() body: unknown): Promise<ImportTaxRatesResponse> {
    const parsed = importTaxRatesRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    const { text, format, dryRun } = parsed.data;
    return importTaxRatesResponseSchema.parse(await this.rates.load(text, format, { dryRun }));
  }
}
