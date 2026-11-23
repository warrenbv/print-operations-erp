// How the API reads a query string and an empty body, and the cross-origin write it refuses before reading anything.
// Applied wherever the application is created: apps/api/src/main.ts and each end-to-end test, so the tests drive the
// handling the process runs. Pinned by apps/api/test/request-parsing.e2e.test.ts and apps/api/test/origin-check.e2e.test.ts.
import type { INestApplication } from '@nestjs/common';
import type { Application, NextFunction, Request, Response } from 'express';
import { parse } from 'qs';

import { configuredWebOrigin, refuseForeignOriginWrites } from './origin-check';

export function applyRequestParsing(app: INestApplication): void {
  const express = app.getHttpAdapter().getInstance() as Application;

  // First, and before Nest adds its body parsers when the app starts, so a refused write has no body or upload read.
  app.use(refuseForeignOriginWrites(configuredWebOrigin(process.env)));

  // Brackets build objects and arrays (`status[]=a`, `customerId[x]=1`). The list routes refuse those by type with a
  // reason word (apps/api/src/list-query.ts), where a flat parser would pass `status[]` through as an unknown key.
  // A repeated key stays one array up to 1000 values, above the 100 ids a list filter accepts
  // (CUSTOMER_SEARCH_MAX_LIMIT in packages/types/src/customer.ts). At the qs default of 20 it would turn into an object.
  express.set('query parser', (query: string) =>
    parse(query, { allowPrototypes: true, arrayLimit: 1000 }),
  );

  // A request with no body, or one the JSON and form parsers skip, reaches the route as `{}`, so a schema reports the
  // missing fields by name and an all-optional request body still parses.
  app.use((request: Request, _response: Response, next: NextFunction) => {
    if (request.body === undefined) {
      request.body = {};
    }
    next();
  });
}
