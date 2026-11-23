// The notifications composition root: the send log, the mail sink and the notice to a sender whose email failed.
// Memory mode always writes mail to the console, even with every SMTP_ key set. Production refuses to start without all four keys.
// SMTP_CA_FILE names the authority to trust for a relay with a private certificate. A set one that is not a readable PEM bundle stops the start.
// MAIL_REDIRECT_TO and MAIL_REDIRECT_ALLOW divert mail to one mailbox. Tests: apps/api/test/notifications.factory.test.ts and apps/api/test/mail-redirect.test.ts.
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPool } from '@erp/db';
import { resolvePersistenceModeFromEnv } from '../config/persistence-guard';
import { apiClock } from '../test-clock';
import { createFailureNotifier, type FailureNotifier } from './notify-sender-of-failure';
import {
  ConsoleMailSink,
  DrizzleSendLog,
  InMemorySendLog,
  RedirectingMailSink,
  RetryingMailSink,
  SmtpMailSink,
  consoleMailLog,
  createNotificationsDb,
  smtpTlsMode,
  type MailLog,
  type MailRedirect,
  type MailSink,
  type SendLog,
  type SmtpMailSinkConfig,
  type SmtpTlsMode,
} from '@erp/notifications';

export const MAIL_SINK = Symbol('MAIL_SINK');

export const SEND_LOG = Symbol('SEND_LOG');

export interface SendLogHandle {
  log: SendLog;
  close(): Promise<void>;
}

export function createSendLog(env: NodeJS.ProcessEnv = process.env): SendLogHandle {
  const persistence = resolvePersistenceModeFromEnv(env);

  if (persistence === 'memory') {
    return { log: new InMemorySendLog(), close: async () => undefined };
  }

  const pool = createPool();
  return { log: new DrizzleSendLog(createNotificationsDb(pool)), close: () => pool.end() };
}

export const MAIL_LOG = Symbol('MAIL_LOG');

export const SENDER_NOTIFIER = Symbol('SENDER_NOTIFIER');

const REQUIRED_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM_ADDRESS', 'SMTP_RETURN_PATH'] as const;

const CA_FILE_KEY = 'SMTP_CA_FILE';

export type ReadFileSync = (path: string) => Buffer;

type MailTransport = 'smtp' | 'console';

export interface MailTransportChoice {
  transport: MailTransport;

  reason: 'configured' | 'memory-persistence' | 'unconfigured';

  host?: string;
  port?: number;

  tls?: SmtpTlsMode;

  caFile?: string;
  caCertificate?: string;
}

function missingKeys(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_KEYS.filter((key) => {
    const value = env[key];
    return value === undefined || value.trim() === '';
  });
}

function resolvePort(env: NodeJS.ProcessEnv): number {
  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`SMTP_PORT must be a positive integer, got "${env.SMTP_PORT}"`);
  }
  return port;
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

interface CaBundle {
  caFile: string;
  caCertificate: string;
}

function resolveCaFile(env: NodeJS.ProcessEnv, readFile: ReadFileSync): CaBundle | undefined {
  const caFile = (env[CA_FILE_KEY] ?? '').trim();
  if (caFile === '') {
    return undefined;
  }

  let text: string;
  try {
    text = readFile(caFile).toString('utf8');
  } catch (err) {
    throw new Error(
      `${CA_FILE_KEY} "${caFile}" is not readable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const certificates = text.match(PEM_CERTIFICATE) ?? [];
  if (certificates.length === 0) {
    throw new Error(`${CA_FILE_KEY} "${caFile}" holds no PEM certificate`);
  }
  for (const certificate of certificates) {
    try {
      new X509Certificate(certificate);
    } catch {
      throw new Error(`${CA_FILE_KEY} "${caFile}" holds a certificate that does not parse`);
    }
  }
  return { caFile, caCertificate: certificates.join('\n') };
}

export function describeMailTransport(
  env: NodeJS.ProcessEnv = process.env,

  readFile: ReadFileSync = readFileSync,
): MailTransportChoice {
  const missing = missingKeys(env);

  if (env.NODE_ENV === 'production' && missing.length > 0) {
    throw new Error(
      `outbound mail is not configured — missing ${missing.join(', ')} ` +
        '(set every required SMTP_ variable, or run outside production)',
    );
  }

  // The port is checked before the memory-mode answer, so a bad SMTP_PORT is reported in development too.
  const port = missing.length === 0 ? resolvePort(env) : undefined;

  // A set SMTP_CA_FILE is checked whatever else is set, so a bad one never goes unnoticed.
  const ca = resolveCaFile(env, readFile);

  const persistence = resolvePersistenceModeFromEnv(env);

  if (persistence === 'memory') {
    return {
      transport: 'console',

      reason: missing.length === 0 ? 'memory-persistence' : 'unconfigured',
    };
  }

  if (missing.length > 0) {
    return { transport: 'console', reason: 'unconfigured' };
  }

  return {
    transport: 'smtp',
    reason: 'configured',
    host: env.SMTP_HOST as string,
    port: port as number,
    tls: smtpTlsMode(port as number),
    ...ca,
  };
}

/** The relay settings handed to the SMTP sink, the trusted authority included. */
export function smtpSinkConfig(
  choice: MailTransportChoice,
  env: NodeJS.ProcessEnv = process.env,
): SmtpMailSinkConfig {
  return {
    host: choice.host as string,
    port: choice.port as number,
    fromAddress: env.SMTP_FROM_ADDRESS as string,
    returnPath: env.SMTP_RETURN_PATH as string,
    ...(choice.caCertificate === undefined ? {} : { caCertificate: choice.caCertificate }),
  };
}

const REDIRECT_TO_KEY = 'MAIL_REDIRECT_TO';
const REDIRECT_ALLOW_KEY = 'MAIL_REDIRECT_ALLOW';

const MAIL_ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * Mail to anyone not on MAIL_REDIRECT_ALLOW goes to the MAIL_REDIRECT_TO mailbox instead.
 * An allow list with no catch-all is refused, because every recipient not on it would be mailed for real.
 */
export function describeMailRedirect(
  env: NodeJS.ProcessEnv = process.env,
): MailRedirect | undefined {
  const to = (env[REDIRECT_TO_KEY] ?? '').trim();
  const allow = (env[REDIRECT_ALLOW_KEY] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  if (to === '') {
    if (allow.length > 0) {
      throw new Error(
        `${REDIRECT_ALLOW_KEY} is set but ${REDIRECT_TO_KEY} is not — with no catch-all ` +
          'mailbox, every recipient not on the list would be mailed for real',
      );
    }
    return undefined;
  }

  if (!MAIL_ADDRESS.test(to)) {
    throw new Error(`${REDIRECT_TO_KEY} must be one email address, got "${to}"`);
  }
  const notAddresses = allow.filter((entry) => !MAIL_ADDRESS.test(entry));
  if (notAddresses.length > 0) {
    throw new Error(
      `${REDIRECT_ALLOW_KEY} must be email addresses separated by commas; ` +
        `not an address: ${notAddresses.join(', ')}`,
    );
  }
  return { to, allow };
}

const WEB_BASE_URL_KEY = 'WEB_BASE_URL';

/** The web app's address, for links in internal alerts. When it is unset, an alert names the page in words. */
export function describeWebBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (env[WEB_BASE_URL_KEY] ?? '').trim();
  if (raw === '') {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `${WEB_BASE_URL_KEY} must be an absolute URL such as https://erp.example.test, got "${raw}"`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${WEB_BASE_URL_KEY} must be an http or https URL, got "${raw}"`);
  }

  return raw.replace(/\/+$/, '');
}

function announce(
  choice: MailTransportChoice,
  redirect: MailRedirect | undefined,
  log: MailLog,
): void {
  const line = {
    kind: 'mail',
    event: 'mail_transport_selected',
    transport: choice.transport,
    reason: choice.reason,
    ...(choice.host === undefined
      ? {}
      : {
          host: choice.host,
          port: choice.port,
          tls: choice.tls,
          ...(choice.caFile === undefined
            ? { trust: 'system' }
            : { trust: 'ca-file', caFile: choice.caFile }),
        }),

    ...(redirect === undefined
      ? {}
      : { redirect: { to: redirect.to, allow: [...redirect.allow] } }),
  };

  if (choice.reason === 'memory-persistence') {
    log.warn({
      ...line,
      detail:
        'SMTP_* keys are set but persistence is in-memory, so mail goes to stdout. ' +
        'Set DATABASE_URL (or DATA_PERSISTENCE=postgres) to send for real.',
    });
    return;
  }

  if (redirect !== undefined) {
    log.warn({
      ...line,
      detail:
        `Test mode: mail to anyone not in ${REDIRECT_ALLOW_KEY} goes to ${redirect.to}. ` +
        `Remove ${REDIRECT_TO_KEY} and ${REDIRECT_ALLOW_KEY} at launch.`,
    });
    return;
  }
  log.info(line);
}

export function createMailSink(
  env: NodeJS.ProcessEnv = process.env,

  log: MailLog = consoleMailLog,
): MailSink {
  const choice = describeMailTransport(env);

  const redirect = describeMailRedirect(env);
  announce(choice, redirect, log);

  const sink =
    choice.transport === 'console'
      ? new RetryingMailSink(new ConsoleMailSink(apiClock), log)
      : new RetryingMailSink(new SmtpMailSink(smtpSinkConfig(choice, env), apiClock), log);
  // Redirection wraps the retrying sink, so a redirected send is retried like any other.
  return redirect === undefined ? sink : new RedirectingMailSink(sink, redirect);
}

export function createSenderNotifier(
  mail: MailSink,
  sendLog: SendLog,
  log: MailLog,
  identity: { users: { findByUsername(username: string): Promise<{ email?: string } | null> } },
): FailureNotifier {
  return createFailureNotifier({
    mail,
    sendLog,
    log,
    senders: identity.users,
  });
}
