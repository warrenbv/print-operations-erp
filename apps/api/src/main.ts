// Boots the API: the cross-origin write refusal with query and body parsing, cookie parsing, an optional proxy trust and
// CORS origin, then the listen address.
// The modules and the global guards are composed in apps/api/src/app.module.ts. Listen address: apps/api/src/config/listen-address.ts.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { resolveListenAddress } from './config/listen-address';
import { configuredWebOrigin } from './config/origin-check';
import { applyRequestParsing } from './config/request-parsing';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  applyRequestParsing(app);
  app.use(cookieParser());

  // Trusted only when TRUST_PROXY says so, because `request.ip` is the source address in the sign-in and refusal audit.
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  // The same WEB_ORIGIN that apps/api/src/config/origin-check.ts admits a write from.
  const webOrigin = configuredWebOrigin(process.env);
  if (webOrigin !== undefined) {
    app.enableCors({ origin: webOrigin, credentials: true });
  }

  const { host, port } = resolveListenAddress(process.env);
  await app.listen(port, host);
}

void bootstrap();
