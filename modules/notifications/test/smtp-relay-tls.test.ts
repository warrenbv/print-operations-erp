// The SMTP sink against a relay on the loopback address that does speak TLS: the certificate check on
// the STARTTLS and the implicit TLS path, and a delivery once the relay is trusted. The certificate is
// generated in memory for each run, so no key exists outside the test process.
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { createSecureContext, createServer as createTlsServer, TLSSocket } from 'node:tls';

import { createTransport } from 'nodemailer';
import { describe, expect, it } from 'vitest';

import {
  IMPLICIT_TLS_PORT,
  SmtpMailSink,
  smtpTransportOptions,
  type SmtpMailSinkConfig,
} from '../src/adapters/smtp/smtp-mail-sink';
import { MailSubmissionError, type Clock, type OutboundEmail } from '../src/ports';

const CONFIG: SmtpMailSinkConfig = {
  host: '127.0.0.1',
  port: 25,
  fromAddress: 'erp@example.test',
  returnPath: 'erp-bounces@example.test',
};

const clock: Clock = { now: () => new Date('2026-08-14T12:00:00Z') };

const MAIL: OutboundEmail = {
  to: ['customer@example.com'],
  cc: ['sales@example.test'],
  subject: 'Quote Q-3187',
  textBody: 'Please find your quote attached.',
  attachments: [
    { filename: 'quote-q-3187.pdf', contentType: 'application/pdf', bytes: new Uint8Array([1, 2]) },
  ],
};

// A minimal DER encoder, enough for one self-signed X.509 certificate.
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  let length: Buffer;
  if (body.length < 0x80) {
    length = Buffer.from([body.length]);
  } else {
    const bytes: number[] = [];
    for (let n = body.length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
    length = Buffer.from([0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const groups = [arc & 0x7f];
    for (let n = arc >> 7; n > 0; n >>= 7) groups.unshift((n & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return der(0x06, Buffer.from(bytes));
}

function utcTime(date: Date): Buffer {
  const text = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
  return der(0x17, Buffer.from(text, 'ascii'));
}

type SubjectAltName = { ip: readonly number[] } | { dns: string };

/** A self-signed certificate and its key, in PEM. */
function selfSignedCertificate(altName: SubjectAltName): { cert: string; key: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ecdsaWithSha256 = der(0x30, oid('1.2.840.10045.4.3.2'));
  const name = der(
    0x30,
    der(0x31, der(0x30, oid('2.5.4.3'), der(0x0c, Buffer.from('loopback relay')))),
  );
  const now = Date.now();
  const validity = der(
    0x30,
    utcTime(new Date(now - 60 * 60 * 1000)),
    utcTime(new Date(now + 24 * 60 * 60 * 1000)),
  );
  const serial = randomBytes(8);
  serial[0] = (serial[0] ?? 0) & 0x7f;
  const generalName =
    'ip' in altName ? der(0x87, Buffer.from(altName.ip)) : der(0x82, Buffer.from(altName.dns));
  const extensions = der(
    0xa3,
    der(
      0x30,
      der(0x30, oid('2.5.29.17'), der(0x04, der(0x30, generalName))),
      der(
        0x30,
        oid('2.5.29.19'),
        der(0x01, Buffer.from([0xff])),
        der(0x04, der(0x30, der(0x01, Buffer.from([0xff])))),
      ),
    ),
  );
  const tbs = der(
    0x30,
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    ecdsaWithSha256,
    name,
    validity,
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = sign('sha256', tbs, privateKey);
  const certificate = der(
    0x30,
    tbs,
    ecdsaWithSha256,
    der(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  const base64 = certificate.toString('base64').replace(/(.{64})/g, '$1\n');
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${base64.trim()}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

interface RelayCommand {
  line: string;
  encrypted: boolean;
}

interface LoopbackRelay {
  port: number;
  commands: RelayCommand[];
  messages: string[];
  close(): Promise<void>;
}

// Speaks SMTP on one socket and records every command with whether it arrived encrypted.
// `upgrade` is called on STARTTLS and returns the encrypted socket, or is absent for implicit TLS.
// A session that continues after STARTTLS sends no second greeting.
function serveSession(
  socket: Socket,
  encrypted: boolean,
  relay: Pick<LoopbackRelay, 'commands' | 'messages'>,
  upgrade?: (plain: Socket) => Socket,
  upgraded = false,
) {
  socket.on('error', () => undefined);
  let buffered = '';
  let message: string[] | undefined;
  const onData = (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    let end: number;
    while ((end = buffered.indexOf('\r\n')) >= 0) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (message !== undefined) {
        if (line === '.') {
          relay.messages.push(message.join('\r\n'));
          message = undefined;
          socket.write('250 queued\r\n');
        } else {
          message.push(line);
        }
        continue;
      }
      relay.commands.push({ line, encrypted });
      const verb = line.split(' ')[0]?.toUpperCase();
      if (verb === 'EHLO') {
        socket.write(
          encrypted ? '250 relay.example.test\r\n' : '250-relay.example.test\r\n250 STARTTLS\r\n',
        );
      } else if (verb === 'STARTTLS' && upgrade !== undefined && !encrypted) {
        socket.write('220 ready\r\n');
        socket.removeListener('data', onData);
        serveSession(upgrade(socket), true, relay, undefined, true);
        return;
      } else if (verb === 'DATA') {
        message = [];
        socket.write('354 go ahead\r\n');
      } else if (verb === 'QUIT') {
        socket.end('221 bye\r\n');
      } else {
        socket.write('250 OK\r\n');
      }
    }
  };
  socket.on('data', onData);
  if (!upgraded) socket.write('220 relay.example.test ESMTP\r\n');
}

async function listen(
  server: Server,
  relay: Pick<LoopbackRelay, 'commands' | 'messages'>,
): Promise<LoopbackRelay> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    ...relay,
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A relay that offers STARTTLS and presents the given certificate once it is asked to. */
function startTlsRelay(credentials: { cert: string; key: string }): Promise<LoopbackRelay> {
  const relay = { commands: [] as RelayCommand[], messages: [] as string[] };
  const secureContext = createSecureContext(credentials);
  const server = createServer((socket) =>
    serveSession(socket, false, relay, (plain) => {
      const secured = new TLSSocket(plain, { isServer: true, secureContext });
      return secured as unknown as Socket;
    }),
  );
  return listen(server, relay);
}

/** A relay that speaks TLS from the first byte with the given certificate. */
function implicitTlsRelay(credentials: { cert: string; key: string }): Promise<LoopbackRelay> {
  const relay = { commands: [] as RelayCommand[], messages: [] as string[] };
  const server = createTlsServer(credentials, (socket) =>
    serveSession(socket as unknown as Socket, true, relay),
  );
  server.on('tlsClientError', () => undefined);
  return listen(server as unknown as Server, relay);
}

// The implicit TLS options exactly as the sink builds them for port 465, pointed at the relay's port.
function implicitTlsSink(relay: LoopbackRelay, config: SmtpMailSinkConfig = CONFIG) {
  const options = smtpTransportOptions({ ...config, port: IMPLICIT_TLS_PORT });
  return new SmtpMailSink(
    { ...config, port: IMPLICIT_TLS_PORT },
    clock,
    createTransport({ ...options, port: relay.port }),
  );
}

function causeMessages(failure: unknown): string {
  const messages: string[] = [];
  for (let e: unknown = failure; e instanceof Error; e = e.cause) messages.push(e.message);
  return messages.join(' | ');
}

const MAIL_COMMAND = /^(MAIL|RCPT|DATA)\b/i;

const LOOPBACK: SubjectAltName = { ip: [127, 0, 0, 1] };

describe('SmtpMailSink — STARTTLS to a relay whose certificate does not verify', () => {
  it('refuses a certificate that chains to no trusted authority, before the envelope', async () => {
    const relay = await startTlsRelay(selfSignedCertificate(LOOPBACK));
    try {
      const sink = new SmtpMailSink({ ...CONFIG, port: relay.port }, clock);

      const failure = await sink.submit(MAIL).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(MailSubmissionError);
      expect(causeMessages(failure)).toMatch(/self[- ]signed certificate/i);
      expect(relay.commands.map((c) => c.line)).toContain('STARTTLS');
      expect(relay.commands.filter((c) => MAIL_COMMAND.test(c.line))).toEqual([]);
      expect(relay.messages).toEqual([]);
    } finally {
      await relay.close();
    }
  });

  it('still refuses it when NODE_TLS_REJECT_UNAUTHORIZED=0 is set in the environment', async () => {
    const relay = await startTlsRelay(selfSignedCertificate(LOOPBACK));
    const before = process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    try {
      const sink = new SmtpMailSink({ ...CONFIG, port: relay.port }, clock);

      const failure = await sink.submit(MAIL).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(MailSubmissionError);
      expect(relay.commands.filter((c) => MAIL_COMMAND.test(c.line))).toEqual([]);
      expect(relay.messages).toEqual([]);
    } finally {
      if (before === undefined) delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
      else process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = before;
      await relay.close();
    }
  });

  it('refuses a trusted certificate that names another host', async () => {
    const credentials = selfSignedCertificate({ dns: 'relay.example.test' });
    const relay = await startTlsRelay(credentials);
    try {
      const sink = new SmtpMailSink(
        { ...CONFIG, port: relay.port, caCertificate: credentials.cert },
        clock,
      );

      const failure = await sink.submit(MAIL).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(MailSubmissionError);
      expect(causeMessages(failure)).toMatch(/127\.0\.0\.1/);
      expect(causeMessages(failure)).not.toMatch(/self[- ]signed/i);
      expect(relay.commands.filter((c) => MAIL_COMMAND.test(c.line))).toEqual([]);
      expect(relay.messages).toEqual([]);
    } finally {
      await relay.close();
    }
  });
});

describe('SmtpMailSink — STARTTLS to a relay trusted through caCertificate', () => {
  it('sends the envelope and the message only after the upgrade', async () => {
    const credentials = selfSignedCertificate(LOOPBACK);
    const relay = await startTlsRelay(credentials);
    try {
      const sink = new SmtpMailSink(
        { ...CONFIG, port: relay.port, caCertificate: credentials.cert },
        clock,
      );

      const submission = await sink.submit(MAIL);

      const upgrade = relay.commands.findIndex((c) => c.line === 'STARTTLS');
      expect(upgrade).toBeGreaterThan(-1);
      expect(relay.commands.slice(0, upgrade + 1).every((c) => !c.encrypted)).toBe(true);
      expect(relay.commands.slice(upgrade + 1).every((c) => c.encrypted)).toBe(true);
      expect(relay.commands.slice(0, upgrade).map((c) => c.line.split(' ')[0])).toEqual(['EHLO']);
      expect(relay.commands.filter((c) => MAIL_COMMAND.test(c.line)).map((c) => c.line)).toEqual([
        'MAIL FROM:<erp-bounces@example.test>',
        'RCPT TO:<customer@example.com>',
        'RCPT TO:<sales@example.test>',
        'DATA',
      ]);
      expect(relay.messages).toHaveLength(1);
      expect(relay.messages[0]).toContain(`\r\nMessage-ID: ${submission.messageId}\r\n`);
      expect(relay.messages[0]).toMatch(/^From: erp@example\.test\r\n/m);
    } finally {
      await relay.close();
    }
  });
});

describe('SmtpMailSink — implicit TLS', () => {
  it('refuses a certificate that chains to no trusted authority, before any command', async () => {
    const relay = await implicitTlsRelay(selfSignedCertificate(LOOPBACK));
    try {
      const failure = await implicitTlsSink(relay)
        .submit(MAIL)
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(MailSubmissionError);
      expect(causeMessages(failure)).toMatch(/self[- ]signed certificate/i);
      expect(relay.commands).toEqual([]);
      expect(relay.messages).toEqual([]);
    } finally {
      await relay.close();
    }
  });

  it('delivers to a relay trusted through caCertificate', async () => {
    const credentials = selfSignedCertificate(LOOPBACK);
    const relay = await implicitTlsRelay(credentials);
    try {
      const submission = await implicitTlsSink(relay, {
        ...CONFIG,
        caCertificate: credentials.cert,
      }).submit(MAIL);

      expect(relay.commands.every((c) => c.encrypted)).toBe(true);
      expect(relay.commands.map((c) => c.line)).not.toContain('STARTTLS');
      expect(relay.messages).toHaveLength(1);
      expect(relay.messages[0]).toContain(`\r\nMessage-ID: ${submission.messageId}\r\n`);
    } finally {
      await relay.close();
    }
  });
});
