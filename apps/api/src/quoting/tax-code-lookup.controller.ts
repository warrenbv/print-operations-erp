// Finds the tax jurisdiction of a delivery address. A POST that stores nothing, open to any signed-in user.
// The service: modules/quoting/src/services/tax-code-lookup-service.ts.
import { TaxCodeLookupService } from '@erp/quoting';
import {
  businessDayOf,
  refusalBody,
  taxCodeLookupRequestSchema,
  taxCodeLookupResponseSchema,
  type TaxCodeLookupResponse,
} from '@erp/types';
import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';

import { Authenticated } from '../auth/authz.decorators';
import { apiClock } from '../test-clock';

@Controller('quoting/tax-code-lookup')
export class TaxCodeLookupController {
  constructor(@Inject(TaxCodeLookupService) private readonly lookup: TaxCodeLookupService) {}

  @Authenticated()
  @HttpCode(200)
  @Post()
  async lookUp(@Body() body: unknown): Promise<TaxCodeLookupResponse> {
    const parsed = taxCodeLookupRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    const asOf = businessDayOf(apiClock.now());
    return taxCodeLookupResponseSchema.parse(await this.lookup.lookUp(parsed.data, asOf));
  }
}
