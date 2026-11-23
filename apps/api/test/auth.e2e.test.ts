// End-to-end over HTTP: sign-in, the session cookie, the signed-in user and sign-out, and public routes left open by the global guards.
import { DEV_USERNAMES } from '@erp/identity';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { loginErrorSchema } from '@erp/types';
import cookieParser from 'cookie-parser';
import { applyRequestParsing } from '../src/config/request-parsing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DEV_PASSWORD = 'dev-password';
const BREAK_GLASS_PASSWORD = 'sealed-emergency-password';

process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'local';

process.env.DATA_PERSISTENCE = 'memory';
process.env.LOCAL_AUTH_PASSWORD = DEV_PASSWORD;
process.env.LOCAL_AUTH_USERS = DEV_USERNAMES.join(',');
process.env.BREAK_GLASS_DEV_PASSWORD = BREAK_GLASS_PASSWORD;

process.env.SESSION_COOKIE_INSECURE = 'true';

let app: INestApplication;

beforeAll(async () => {
  const { AuthModule } = await import('../src/auth/auth.module');
  const { HealthModule } = await import('../src/health/health.module');

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule, HealthModule],
  }).compile();
  app = moduleRef.createNestApplication();
  applyRequestParsing(app);
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await app.close();
});

function http(): request.Agent {
  return request(app.getHttpServer());
}

describe('POST /auth/login', () => {
  it('signs a dev user in and sets an httpOnly session cookie', async () => {
    const response = await http()
      .post('/auth/login')
      .send({ username: 'dev-sales', password: DEV_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.username).toBe('dev-sales');

    expect(response.body.user.roles).toEqual([]);
    expect(typeof response.body.expiresAt).toBe('string');

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((cookie) => cookie.startsWith('erp_session='));
    expect(session).toBeDefined();
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');

    expect(JSON.stringify(response.body)).not.toContain('erp_session');
  });

  it('rejects a wrong password with 401 and no cookie', async () => {
    const response = await http()
      .post('/auth/login')
      .send({ username: 'dev-sales', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(loginErrorSchema.parse(response.body).reason).toBe('invalid-credentials');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('gives an unknown user the same answer as a wrong password', async () => {
    const response = await http()
      .post('/auth/login')
      .send({ username: 'nobody', password: DEV_PASSWORD });

    expect(response.status).toBe(401);
    expect(loginErrorSchema.parse(response.body).reason).toBe('invalid-credentials');
  });

  it.each([
    ['a missing password', { username: 'dev-sales' }],
    ['an empty username', { username: '', password: DEV_PASSWORD }],
    ['a non-object body', 'nonsense'],
  ])('rejects %s without leaking that the body was malformed', async (_label, body) => {
    const response = await http().post('/auth/login').send(body);
    expect(response.status).toBe(401);
    expect(loginErrorSchema.parse(response.body).reason).toBe('invalid-credentials');
  });
});

describe('GET /auth/me', () => {
  it('rejects an anonymous request', async () => {
    expect((await http().get('/auth/me')).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const response = await http().get('/auth/me').set('Cookie', 'erp_session=not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('returns the signed-in user for a live session', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ username: 'dev-billing', password: DEV_PASSWORD });

    const response = await agent.get('/auth/me');
    expect(response.status).toBe(200);
    expect(response.body.username).toBe('dev-billing');
  });
});

describe('POST /auth/logout', () => {
  it('ends the session so the cookie stops working', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ username: 'dev-production', password: DEV_PASSWORD });
    expect((await agent.get('/auth/me')).status).toBe(200);

    expect((await agent.post('/auth/logout')).status).toBe(204);
    expect((await agent.get('/auth/me')).status).toBe(401);
  });

  it('is idempotent for a client with no session', async () => {
    expect((await http().post('/auth/logout')).status).toBe(204);
  });
});

describe('GET /health (global guards must not break public routes)', () => {
  it('serves the health payload without a session', async () => {
    const response = await http().get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});

describe('break-glass over HTTP', () => {
  it('signs in with the implicit Admin role while carrying no stored roles', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/auth/login')
      .send({ username: 'break-glass', password: BREAK_GLASS_PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.user.roles).toEqual(['Admin']);

    const me = await agent.get('/auth/me');
    expect(me.body.roles).toEqual(['Admin']);
  });

  it('rejects a wrong break-glass password like any other bad credential', async () => {
    const response = await http()
      .post('/auth/login')
      .send({ username: 'break-glass', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(loginErrorSchema.parse(response.body).reason).toBe('invalid-credentials');
  });
});
