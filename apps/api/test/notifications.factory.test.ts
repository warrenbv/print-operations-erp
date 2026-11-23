// Tests the mail transport choice and its boot refusals in apps/api/src/notifications/notifications.factory.ts.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RetryingMailSink, smtpTransportOptions, type MailLog } from '@erp/notifications';
import { describe, expect, it } from 'vitest';

import {
  createMailSink,
  describeMailTransport,
  describeWebBaseUrl,
  smtpSinkConfig,
  type ReadFileSync,
} from '../src/notifications/notifications.factory';

const FULL_CONFIG = {
  SMTP_HOST: 'mail.example.test',
  SMTP_PORT: '25',
  SMTP_FROM_ADDRESS: 'erp@example.test',
  SMTP_RETURN_PATH: 'erp-bounces@example.test',
};

const DEPLOYED = { DATABASE_URL: 'postgres://erp@db.example.test:5432/erp' };

// A self-signed certificate with no key anywhere, made only so the bundle check has a real one to parse.
const EXAMPLE_CA = `-----BEGIN CERTIFICATE-----
MIIBmzCCAUCgAwIBAgIUNR3uzmnjEcuk1fSWFj2oETTebPcwCgYIKoZIzj0EAwIw
MjEQMA4GA1UECgwHRXhhbXBsZTEeMBwGA1UEAwwVRXhhbXBsZSBSZWxheSBUZXN0
IENBMCAXDTI2MTEyMjE5NTAzMloYDzIxMjYxMDI5MTk1MDMyWjAyMRAwDgYDVQQK
DAdFeGFtcGxlMR4wHAYDVQQDDBVFeGFtcGxlIFJlbGF5IFRlc3QgQ0EwWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAAT3e915IpTfnK4N4GbJBM6CB0+KKa4ikmuo04wf
IhIVBULuLDuRwhGiV39vKnwxqvTtcUz2xtoMKJrZq8j63CAvozIwMDAdBgNVHQ4E
FgQUpwOS3SA2Fe9t3bOb/Ent28lPb28wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjO
PQQDAgNJADBGAiEA2Kxwi2FUW08Oh3NjCH66XtyBwGUrVCecq1d254w0abYCIQCC
n7oav2mgcooqIk827kEh6o/H+p96qgYVBC3/pcymww==
-----END CERTIFICATE-----`;

const CA_PATH = '/etc/ssl/example/relay-ca.pem';

function readOnly(files: Record<string, string>): ReadFileSync {
  return (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return Buffer.from(text, 'utf8');
  };
}

const withCa = readOnly({ [CA_PATH]: EXAMPLE_CA });

function recordingLog() {
  const lines: { level: string; line: Record<string, unknown> }[] = [];
  const log: MailLog = {
    info: (line) => lines.push({ level: 'info', line }),
    warn: (line) => lines.push({ level: 'warn', line }),
    error: (line) => lines.push({ level: 'error', line }),
  };
  return { log, lines };
}

describe('createMailSink — boot discipline', () => {
  it('refuses to boot in production with any SMTP key missing, naming the gaps', () => {
    const env = { NODE_ENV: 'production', SMTP_HOST: 'mail.example.test' };

    expect(() => createMailSink(env)).toThrow(/SMTP_PORT, SMTP_FROM_ADDRESS, SMTP_RETURN_PATH/);
  });

  it('treats a blank key the same as a missing one', () => {
    const env = { NODE_ENV: 'production', ...FULL_CONFIG, SMTP_RETURN_PATH: '  ' };

    expect(() => createMailSink(env)).toThrow(/SMTP_RETURN_PATH/);
  });

  it('boots in production with all four keys, behind the retry decorator', () => {
    const sink = createMailSink({ NODE_ENV: 'production', ...DEPLOYED, ...FULL_CONFIG });

    expect(sink).toBeInstanceOf(RetryingMailSink);
  });

  it('rejects a non-numeric SMTP_PORT instead of dialling NaN', () => {
    const env = { NODE_ENV: 'production', ...FULL_CONFIG, SMTP_PORT: 'twenty-five' };

    expect(() => createMailSink(env)).toThrow(/SMTP_PORT/);
  });

  it('reports a bad port in development too, not only in production', () => {
    const env = { NODE_ENV: 'development', ...DEPLOYED, ...FULL_CONFIG, SMTP_PORT: '0' };

    expect(() => createMailSink(env)).toThrow(/SMTP_PORT/);
  });
});

describe('describeMailTransport — console vs relay is decided, not guessed', () => {
  it('uses the relay for a real deployment with the keys set', () => {
    const choice = describeMailTransport({
      NODE_ENV: 'development',
      ...DEPLOYED,
      ...FULL_CONFIG,
    });

    expect(choice).toMatchObject({
      transport: 'smtp',
      reason: 'configured',
      host: 'mail.example.test',
      port: 25,
    });
  });

  it('falls back to the console sink when nothing is configured', () => {
    const choice = describeMailTransport({ NODE_ENV: 'development' });

    expect(choice).toMatchObject({ transport: 'console', reason: 'unconfigured' });
  });

  it('keeps a real deployment with a missing key on the console sink', () => {
    const choice = describeMailTransport({
      NODE_ENV: 'development',
      ...DEPLOYED,
      ...FULL_CONFIG,
      SMTP_HOST: '',
    });

    expect(choice).toMatchObject({ transport: 'console', reason: 'unconfigured' });
  });

  it('refuses the relay in memory mode even with every key set', () => {
    const choice = describeMailTransport({ NODE_ENV: 'development', ...FULL_CONFIG });

    expect(choice.transport).toBe('console');
    expect(choice.reason).toBe('memory-persistence');
    expect(choice.host).toBeUndefined();
  });

  it('refuses the relay when persistence is explicitly overridden to memory', () => {
    const choice = describeMailTransport({
      NODE_ENV: 'development',
      ...DEPLOYED,
      ...FULL_CONFIG,
      DATA_PERSISTENCE: 'memory',
    });

    expect(choice.transport).toBe('console');
    expect(choice.reason).toBe('memory-persistence');
  });
});

describe('describeMailTransport — encryption follows the port', () => {
  it('requires STARTTLS on port 25 and trusts the system store', () => {
    const choice = describeMailTransport({ NODE_ENV: 'development', ...DEPLOYED, ...FULL_CONFIG });

    expect(choice).toMatchObject({ transport: 'smtp', tls: 'starttls-required' });
    expect(choice.caFile).toBeUndefined();
    expect(choice.caCertificate).toBeUndefined();
  });

  it('uses implicit TLS on port 465', () => {
    const choice = describeMailTransport({
      NODE_ENV: 'development',
      ...DEPLOYED,
      ...FULL_CONFIG,
      SMTP_PORT: '465',
    });

    expect(choice).toMatchObject({ transport: 'smtp', port: 465, tls: 'implicit-tls' });
  });

  it('hands the sink options that require encryption and verify the certificate', () => {
    const env = { NODE_ENV: 'development', ...DEPLOYED, ...FULL_CONFIG };

    const options = smtpTransportOptions(smtpSinkConfig(describeMailTransport(env), env));

    expect(options).toMatchObject({ secure: false, requireTLS: true });
    expect(options.tls).toEqual({ rejectUnauthorized: true });
  });
});

describe('SMTP_CA_FILE — trusting a private authority', () => {
  const env = { NODE_ENV: 'development', ...DEPLOYED, ...FULL_CONFIG, SMTP_CA_FILE: CA_PATH };

  it('reads the bundle and carries it to the transport with verification still on', () => {
    const choice = describeMailTransport(env, withCa);

    expect(choice.caFile).toBe(CA_PATH);
    expect(choice.caCertificate).toBe(EXAMPLE_CA);
    expect(smtpTransportOptions(smtpSinkConfig(choice, env)).tls).toEqual({
      rejectUnauthorized: true,
      ca: EXAMPLE_CA,
    });
  });

  it('keeps every certificate in a bundle and nothing else from the file', () => {
    const bundle = `# relay chain\n${EXAMPLE_CA}\n\n${EXAMPLE_CA}\n`;

    const choice = describeMailTransport(env, readOnly({ [CA_PATH]: bundle }));

    expect(choice.caCertificate).toBe(`${EXAMPLE_CA}\n${EXAMPLE_CA}`);
  });

  it('treats a blank value as unset', () => {
    const choice = describeMailTransport({ ...env, SMTP_CA_FILE: '  ' }, readOnly({}));

    expect(choice.caFile).toBeUndefined();
  });

  it('refuses to start when the file cannot be read, naming the key and the path', () => {
    expect(() => describeMailTransport(env, readOnly({}))).toThrow(
      /SMTP_CA_FILE "\/etc\/ssl\/example\/relay-ca\.pem" is not readable/,
    );
  });

  it('refuses a file with no PEM certificate in it', () => {
    const notPem = readOnly({ [CA_PATH]: 'relay.example.test' });

    expect(() => describeMailTransport(env, notPem)).toThrow(/SMTP_CA_FILE .* holds no PEM/);
  });

  it('refuses a certificate block that does not parse', () => {
    const broken = readOnly({
      [CA_PATH]: '-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydA==\n-----END CERTIFICATE-----',
    });

    expect(() => describeMailTransport(env, broken)).toThrow(/SMTP_CA_FILE .* does not parse/);
  });

  it('checks the file in memory mode and in production too', () => {
    expect(() =>
      describeMailTransport(
        { NODE_ENV: 'development', ...FULL_CONFIG, SMTP_CA_FILE: CA_PATH },
        readOnly({}),
      ),
    ).toThrow(/SMTP_CA_FILE/);
    expect(() =>
      createMailSink({ ...env, NODE_ENV: 'production', SMTP_CA_FILE: '/example/missing.pem' }),
    ).toThrow(/SMTP_CA_FILE/);
  });
});

describe('createMailSink — announces the choice at boot', () => {
  it('logs which transport was selected, and the relay it will use', () => {
    const { log, lines } = recordingLog();

    createMailSink({ NODE_ENV: 'development', ...DEPLOYED, ...FULL_CONFIG }, log);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.line).toMatchObject({
      kind: 'mail',
      event: 'mail_transport_selected',
      transport: 'smtp',
      host: 'mail.example.test',
      port: 25,
    });
  });

  it('logs how the relay connection is protected', () => {
    const { log, lines } = recordingLog();

    createMailSink({ NODE_ENV: 'development', ...DEPLOYED, ...FULL_CONFIG }, log);

    expect(lines[0]?.line).toMatchObject({ tls: 'starttls-required', trust: 'system' });
    expect(lines[0]?.line).not.toHaveProperty('caFile');
  });

  it('names the trusted bundle when SMTP_CA_FILE is set, reading it from disk', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'erp-smtp-ca-'));
    try {
      const caFile = join(scratch, 'relay-ca.pem');
      writeFileSync(caFile, EXAMPLE_CA);
      const { log, lines } = recordingLog();

      createMailSink(
        {
          NODE_ENV: 'development',
          ...DEPLOYED,
          ...FULL_CONFIG,
          SMTP_PORT: '465',
          SMTP_CA_FILE: caFile,
        },
        log,
      );

      expect(lines[0]?.line).toMatchObject({ tls: 'implicit-tls', trust: 'ca-file', caFile });
      expect(JSON.stringify(lines[0]?.line)).not.toContain('BEGIN CERTIFICATE');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('says so when mail is going to stdout', () => {
    const { log, lines } = recordingLog();

    createMailSink({ NODE_ENV: 'development' }, log);

    expect(lines[0]?.line).toMatchObject({
      event: 'mail_transport_selected',
      transport: 'console',
      reason: 'unconfigured',
    });

    expect(lines[0]?.line).not.toHaveProperty('host');
  });

  it('warns — not informs — when set keys are being ignored', () => {
    const { log, lines } = recordingLog();

    createMailSink({ NODE_ENV: 'development', ...FULL_CONFIG }, log);

    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.line).toMatchObject({
      transport: 'console',
      reason: 'memory-persistence',
    });
    expect(String(lines[0]?.line['detail'])).toMatch(/DATABASE_URL/);
  });
});

describe('describeWebBaseUrl - the address the notice links to', () => {
  it('is absent when nothing is set, which is legal', () => {
    expect(describeWebBaseUrl({})).toBeUndefined();
    expect(describeWebBaseUrl({ WEB_BASE_URL: '   ' })).toBeUndefined();
  });

  it('returns the address it was given', () => {
    expect(describeWebBaseUrl({ WEB_BASE_URL: 'https://erp.example.test' })).toBe(
      'https://erp.example.test',
    );
  });

  it('drops a trailing slash so the one place that appends a path cannot double it', () => {
    expect(describeWebBaseUrl({ WEB_BASE_URL: 'https://erp.example.test/' })).toBe(
      'https://erp.example.test',
    );
  });

  it('refuses a value that is not an absolute URL, naming the key', () => {
    expect(() => describeWebBaseUrl({ WEB_BASE_URL: 'erp.example.test' })).toThrow(/WEB_BASE_URL/);
  });

  it('refuses a scheme that is not http or https', () => {
    expect(() => describeWebBaseUrl({ WEB_BASE_URL: 'ftp://erp.example.test' })).toThrow(
      /http or https/,
    );
  });
});
