// End-to-end over HTTP: how a request is read before any route sees it. Bracketed query parameters, the JSON body limit,
// a request with no body, the upload limits on the purchase order document, and an unknown route.
// The parsing is set in apps/api/src/config/request-parsing.ts. The upload limits are on the route in apps/api/src/orders/orders.controller.ts.
import { DEV_USERNAMES } from '@erp/identity';
import { RECEIVED_DOCUMENT_MAX_BYTES } from '@erp/types';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DEV_PASSWORD = 'dev-password';
const UNKNOWN_ORDER_ID = '01988a00-9999-7000-8000-00000000dead';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.SESSION_COOKIE_INSECURE = 'true';

let app: INestApplication;
let sales: request.Agent;

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { OrdersModule } = await import('../src/orders/orders.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, OrdersModule],
  }).compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');

  sales = request.agent(app.getHttpServer());
  const login = await sales
    .post('/auth/login')
    .send({ username: 'dev-sales', password: DEV_PASSWORD });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe('query parameters', () => {
  it('reads repeated brackets as an array', async () => {
    const both = await sales.get('/orders?status[]=confirmed&status[]=converted');
    expect(both.status).toBe(200);
    expect(Array.isArray(both.body.items)).toBe(true);

    const withEmpty = await sales.get('/orders?status[]=confirmed&status[]=');
    expect(withEmpty.status).toBe(400);
    expect(withEmpty.body).toEqual({ reason: 'invalid-status' });
  });

  it('reads a bracketed key as an object, which a list filter refuses', async () => {
    const customer = await sales.get('/orders?customerId[x]=1');
    expect(customer.status).toBe(400);
    expect(customer.body).toEqual({ reason: 'invalid-customer-id' });

    const status = await sales.get('/orders?status[a]=confirmed');
    expect(status.status).toBe(400);
    expect(status.body).toEqual({ reason: 'invalid-status' });
  });

  it('reads a key repeated 100 times as one array', async () => {
    const ids = Array.from(
      { length: 100 },
      (_, index) => `01988a00-9999-7000-8000-${String(index).padStart(12, '0')}`,
    );
    const response = await sales.get(`/orders?${ids.map((id) => `quoteId=${id}`).join('&')}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });
});

describe('request bodies', () => {
  it('refuses a JSON body over 100 kB with 413', async () => {
    const body = JSON.stringify({
      username: 'dev-sales',
      password: DEV_PASSWORD,
      pad: 'x'.repeat(100 * 1024),
    });
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ statusCode: 413, message: 'request entity too large' });
  });

  it('reads a JSON body just under 100 kB', async () => {
    const pad = 'x'.repeat(100 * 1024 - 80);
    const body = JSON.stringify({ username: 'dev-sales', password: DEV_PASSWORD, pad });
    expect(Buffer.byteLength(body)).toBeLessThan(100 * 1024);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
  });

  it('hands a route an empty object when the request has no body', async () => {
    const response = await sales.post('/orders');

    expect(response.status).toBe(400);
    expect(response.body.formErrors).toEqual([]);
    expect(Object.keys(response.body.fieldErrors)).toContain('quoteId');
  });
});

describe('the purchase order document upload', () => {
  const uploadPath = `/orders/${UNKNOWN_ORDER_ID}/purchase-order/document`;

  it('refuses a file over the size limit with 413', async () => {
    const response = await sales
      .post(uploadPath)
      .attach('file', Buffer.alloc(RECEIVED_DOCUMENT_MAX_BYTES + 1, 0x41), 'big.pdf');

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      message: 'File too large',
      error: 'Payload Too Large',
      statusCode: 413,
    });
  });

  it('refuses a second file with 400', async () => {
    const response = await sales
      .post(uploadPath)
      .attach('file', Buffer.from('%PDF-1.4\n'), 'a.pdf')
      .attach('file', Buffer.from('%PDF-1.4\n'), 'b.pdf');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'Too many files',
      error: 'Bad Request',
      statusCode: 400,
    });
  });

  it('refuses a request with no file with 400 no-file', async () => {
    const response = await sales.post(uploadPath).field('note', 'no file here');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ reason: 'no-file' });
  });
});

describe('an unknown route', () => {
  it('is 404 with the method and path in the message', async () => {
    const response = await request(app.getHttpServer()).get('/no-such-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      message: 'Cannot GET /no-such-route',
      error: 'Not Found',
      statusCode: 404,
    });
  });
});
