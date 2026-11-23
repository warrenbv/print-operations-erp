// Tests mail redirection: its configuration, the wrapped sink, the redirected addresses in the send log and the mail-mode route.
import {
  InMemoryMailSink,
  InMemorySendLog,
  MailSubmissionError,
  RedirectingMailSink,
  systemClock,
  type MailLog,
  type OutboundEmail,
} from '@erp/notifications';
import { describe, expect, it } from 'vitest';

import { MailModeController } from '../src/notifications/mail-mode.controller';
import { createMailSink, describeMailRedirect } from '../src/notifications/notifications.factory';
import { redirectedTo } from '../src/notifications/redirected-to';
import { submitAndRecord } from '../src/notifications/submit-and-record';

const FULL_CONFIG = {
  SMTP_HOST: 'mail.example.test',
  SMTP_PORT: '25',
  SMTP_FROM_ADDRESS: 'erp@example.test',
  SMTP_RETURN_PATH: 'erp-bounces@example.test',
};

const DEPLOYED = { DATABASE_URL: 'postgres://erp@db.example.test:5432/erp' };

const REDIRECT_ENV = {
  MAIL_REDIRECT_TO: 'erp-test@org.example.test',
  MAIL_REDIRECT_ALLOW: 'demo-owner@org.example.test, demo-it@org.example.test',
};

const REDIRECT = { to: 'erp-test@org.example.test', allow: ['demo-owner@org.example.test'] };

const EMAIL: OutboundEmail = {
  to: ['buyer@customer.example.test'],
  subject: 'Your quote',
  textBody: 'Attached.',
};

const ABOUT = {
  subject: { type: 'quote', id: '01a01a98-d215-76bd-ae1e-99bb52bdc29b', label: 'Q-00318' } as const,
  audience: 'customer' as const,
  actor: 'jsmith',
};

function recordingLog() {
  const lines: { level: string; line: Record<string, unknown> }[] = [];
  const log: MailLog = {
    info: (line) => lines.push({ level: 'info', line }),
    warn: (line) => lines.push({ level: 'warn', line }),
    error: (line) => lines.push({ level: 'error', line }),
  };
  return { log, lines };
}

describe('describeMailRedirect', () => {
  it('is off when neither key is set', () => {
    expect(describeMailRedirect({})).toBeUndefined();
  });

  it('reads the catch-all and the allow list, trimming each address', () => {
    expect(describeMailRedirect(REDIRECT_ENV)).toEqual({
      to: 'erp-test@org.example.test',
      allow: ['demo-owner@org.example.test', 'demo-it@org.example.test'],
    });
  });

  it('allows a catch-all with nobody on the allow list', () => {
    expect(describeMailRedirect({ MAIL_REDIRECT_TO: 'erp-test@org.example.test' })).toEqual({
      to: 'erp-test@org.example.test',
      allow: [],
    });
  });

  it('treats blank keys as unset', () => {
    expect(describeMailRedirect({ MAIL_REDIRECT_TO: '  ', MAIL_REDIRECT_ALLOW: ' , ' })).toBe(
      undefined,
    );
  });

  it('refuses an allow list with no catch-all, naming both keys', () => {
    expect(() =>
      describeMailRedirect({ MAIL_REDIRECT_ALLOW: 'demo-owner@org.example.test' }),
    ).toThrow(/MAIL_REDIRECT_ALLOW is set but MAIL_REDIRECT_TO is not/);
  });

  it('refuses a catch-all that is not one address', () => {
    expect(() =>
      describeMailRedirect({ MAIL_REDIRECT_TO: 'a@example.com, b@example.com' }),
    ).toThrow(/MAIL_REDIRECT_TO must be one email address/);
  });

  it('refuses an allow-list entry that is not an address, naming it', () => {
    expect(() =>
      describeMailRedirect({
        ...REDIRECT_ENV,
        MAIL_REDIRECT_ALLOW: 'demo-owner@org.example.test; demo-it',
      }),
    ).toThrow(/not an address: demo-owner@org.example.test; demo-it/);
  });

  it('stops the boot, not only the redirect', () => {
    expect(() =>
      createMailSink({
        NODE_ENV: 'development',
        MAIL_REDIRECT_ALLOW: 'demo-owner@org.example.test',
      }),
    ).toThrow(/MAIL_REDIRECT_TO/);
  });
});

describe('createMailSink with redirect on', () => {
  it('wraps the sink it would otherwise return', () => {
    const sink = createMailSink({ NODE_ENV: 'development', ...REDIRECT_ENV }, recordingLog().log);

    expect(sink).toBeInstanceOf(RedirectingMailSink);
  });

  it('works in production, which is how a deployed server runs', () => {
    const sink = createMailSink(
      { NODE_ENV: 'production', ...DEPLOYED, ...FULL_CONFIG, ...REDIRECT_ENV },
      recordingLog().log,
    );

    expect(sink).toBeInstanceOf(RedirectingMailSink);
  });

  it('warns at boot, naming the catch-all and the allow list', () => {
    const { log, lines } = recordingLog();

    createMailSink({ NODE_ENV: 'development', ...DEPLOYED, ...FULL_CONFIG, ...REDIRECT_ENV }, log);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.line).toMatchObject({
      event: 'mail_transport_selected',
      transport: 'smtp',
      redirect: {
        to: 'erp-test@org.example.test',
        allow: ['demo-owner@org.example.test', 'demo-it@org.example.test'],
      },
    });
    expect(String(lines[0]?.line['detail'])).toMatch(/at launch/);
  });

  it('says nothing about a redirect when it is off', () => {
    const { log, lines } = recordingLog();

    createMailSink({ NODE_ENV: 'development' }, log);

    expect(lines[0]?.line).not.toHaveProperty('redirect');
  });
});

describe('submitAndRecord under redirect', () => {
  it('logs who was addressed and where the relay was really told to go', async () => {
    const inner = new InMemoryMailSink(systemClock);
    const sendLog = new InMemorySendLog();

    await submitAndRecord(
      { mail: new RedirectingMailSink(inner, REDIRECT), sendLog, log: recordingLog().log },
      EMAIL,
      ABOUT,
    );

    expect(sendLog.rows[0]).toMatchObject({
      recipients: ['buyer@customer.example.test'],
      redirectedTo: ['erp-test@org.example.test'],
      outcome: 'accepted',
    });
    expect(inner.submissions[0]?.mail.to).toEqual(['erp-test@org.example.test']);
  });

  it('records the redirect on a refused send too', async () => {
    const inner = new InMemoryMailSink(systemClock);
    inner.rejectNextSubmissions(1);
    const sendLog = new InMemorySendLog();

    await expect(
      submitAndRecord(
        { mail: new RedirectingMailSink(inner, REDIRECT), sendLog, log: recordingLog().log },
        EMAIL,
        ABOUT,
      ),
    ).rejects.toBeInstanceOf(MailSubmissionError);

    expect(sendLog.rows[0]).toMatchObject({
      outcome: 'failed',
      redirectedTo: ['erp-test@org.example.test'],
    });
  });

  it('records no redirect for a tester on the allow list', async () => {
    const sendLog = new InMemorySendLog();

    await submitAndRecord(
      {
        mail: new RedirectingMailSink(new InMemoryMailSink(systemClock), REDIRECT),
        sendLog,
        log: recordingLog().log,
      },
      { ...EMAIL, to: ['demo-owner@org.example.test'] },
      ABOUT,
    );

    expect(sendLog.rows[0]).not.toHaveProperty('redirectedTo');
  });

  it('records no redirect when the sink applies none', async () => {
    const sendLog = new InMemorySendLog();

    await submitAndRecord(
      { mail: new InMemoryMailSink(systemClock), sendLog, log: recordingLog().log },
      EMAIL,
      ABOUT,
    );

    expect(sendLog.rows[0]).not.toHaveProperty('redirectedTo');
  });
});

describe('redirectedTo', () => {
  it('finds the redirect on the sink createMailSink composes', () => {
    const sink = createMailSink({ NODE_ENV: 'development', ...REDIRECT_ENV }, recordingLog().log);

    expect(redirectedTo(sink, ['buyer@customer.example.test'])).toEqual([
      'erp-test@org.example.test',
    ]);
  });

  it('is undefined for a sink that applies no redirect', () => {
    expect(
      redirectedTo(new InMemoryMailSink(systemClock), ['buyer@customer.example.test']),
    ).toBeUndefined();
  });
});

describe('MailModeController', () => {
  it('reports the redirect the composed sink applies', () => {
    const sink = createMailSink({ NODE_ENV: 'development', ...REDIRECT_ENV }, recordingLog().log);

    expect(new MailModeController(sink).mode()).toEqual({
      redirect: {
        to: 'erp-test@org.example.test',
        allow: ['demo-owner@org.example.test', 'demo-it@org.example.test'],
      },
    });
  });

  it('reports no redirect in normal running', () => {
    const sink = createMailSink({ NODE_ENV: 'development' }, recordingLog().log);

    expect(new MailModeController(sink).mode()).toEqual({ redirect: null });
  });
});
