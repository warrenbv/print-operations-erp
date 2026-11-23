// Liveness check. It is public, and it reads real time on purpose: the timestamp is a fact about this process.
import { Controller, Get } from '@nestjs/common';
import { healthPayloadSchema, type HealthPayload } from '@erp/types';

import { Public } from '../auth/authz.decorators';

const SERVICE_NAME = 'erp-api';
const SERVICE_VERSION = process.env.npm_package_version ?? '0.0.0';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): HealthPayload {
    return healthPayloadSchema.parse({
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }
}
