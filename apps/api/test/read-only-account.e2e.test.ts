// End-to-end over HTTP: an account named in READ_ONLY_USERS signs in and out and reads, and is refused a write.
import { DEV_USERNAMES } from '@erp/identity';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DEV_PASSWORD = 'dev-password';
const READ_ONLY_USER = 'dev-noroles';
const ORDINARY_USER = 'dev-sales';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';
process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.SESSION_COOKIE_INSECURE = 'true';
process.env.READ_ONLY_USERS = ' Dev-NoRoles ';

let app: INestApplication;

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
});

afterAll(async () => {
  await app.close();
});

async function signIn(username: string): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const login = await agent.post('/auth/login').send({ username, password: DEV_PASSWORD });
  expect(login.status).toBe(200);
  return agent;
}

describe('an account named in READ_ONLY_USERS', () => {
  it('signs in, which is the @Public() route the rule must not break', async () => {
    await signIn(READ_ONLY_USER);
  });

  it('reads GET /orders', async () => {
    const agent = await signIn(READ_ONLY_USER);
    const response = await agent.get('/orders');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('is refused POST /orders, the same route it just read', async () => {
    const agent = await signIn(READ_ONLY_USER);
    const response = await agent.post('/orders').send({});
    expect(response.status).toBe(403);
  });

  it('signs out, so it is never left holding a session it cannot end', async () => {
    const agent = await signIn(READ_ONLY_USER);
    expect((await agent.post('/auth/logout')).status).toBe(204);
    expect((await agent.get('/auth/me')).status).toBe(401);
  });
});

describe('an account not named in READ_ONLY_USERS', () => {
  it('reaches POST /orders and is refused by the route, not by the rule', async () => {
    const agent = await signIn(ORDINARY_USER);
    const response = await agent.post('/orders').send({});
    expect(response.status).toBe(400);
  });
});
