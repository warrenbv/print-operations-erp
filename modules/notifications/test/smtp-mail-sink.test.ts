// The SMTP sink: encryption and certificate checks, the timeouts, message composition, Message-IDs,
// and which relay replies count as permanent.
import { createServer, type AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { composeMessage, newMessageId } from '../src/message';
import {
  IMPLICIT_TLS_PORT,
  SMTP_TIMEOUTS,
  SmtpMailSink,
  isPermanentRejection,
  smtpTlsMode,
  smtpTransportOptions,
  type SmtpMailSinkConfig,
} from '../src/adapters/smtp/smtp-mail-sink';
import { MailSubmissionError, type Clock, type OutboundEmail } from '../src/ports';
import { DEFAULT_RETRY_POLICY } from '../src/retrying-mail-sink';

const CONFIG: SmtpMailSinkConfig = {
  host: 'mail.example.test',
  port: 25,
  fromAddress: 'erp@example.test',
  returnPath: 'erp-bounces@example.test',
};

const FIXED_NOW = new Date('2026-08-14T12:00:00Z');
const clock: Clock = { now: () => FIXED_NOW };

const MAIL: OutboundEmail = {
  to: ['customer@example.com'],
  cc: ['sales@example.test'],
  subject: 'Quote Q-3187',
  textBody: 'Please find your quote attached.',
  attachments: [
    { filename: 'quote-q-3187.pdf', contentType: 'application/pdf', bytes: new Uint8Array([1, 2]) },
  ],
};

function fakeTransporter(fail?: Error) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,

    transporter: {
      sendMail: async (options: Record<string, unknown>) => {
        if (fail) throw fail;
        calls.push(options);
        return {};
      },
    } as unknown as import('nodemailer').Transporter,
  };
}

describe('smtpTransportOptions — a STARTTLS port must upgrade and verify', () => {
  const options = smtpTransportOptions(CONFIG) as Record<string, unknown>;

  it('opens in plaintext only to upgrade, because port 25 is not implicit TLS', () => {
    expect(smtpTlsMode(25)).toBe('starttls-required');
    expect(options['secure']).toBe(false);
  });

  it('requires STARTTLS, so a relay that does not offer it is refused', () => {
    expect(options['requireTLS']).toBe(true);
  });

  it('never sets ignoreTLS or opportunisticTLS, either of which would send unencrypted', () => {
    expect(options).not.toHaveProperty('ignoreTLS');
    expect(options).not.toHaveProperty('opportunisticTLS');
  });

  it("verifies the certificate against Node's built-in authorities", () => {
    expect(options['tls']).toEqual({ rejectUnauthorized: true });
  });

  it('treats 587 the same as 25', () => {
    expect(smtpTransportOptions({ ...CONFIG, port: 587 })).toMatchObject({
      secure: false,
      requireTLS: true,
      tls: { rejectUnauthorized: true },
    });
  });
});

describe('smtpTransportOptions — port 465 opens with TLS', () => {
  const options = smtpTransportOptions({ ...CONFIG, port: IMPLICIT_TLS_PORT }) as Record<
    string,
    unknown
  >;

  it('connects over TLS from the first byte', () => {
    expect(smtpTlsMode(465)).toBe('implicit-tls');
    expect(options['secure']).toBe(true);
  });

  it('has no STARTTLS step to require or skip', () => {
    expect(options).not.toHaveProperty('requireTLS');
    expect(options).not.toHaveProperty('ignoreTLS');
    expect(options).not.toHaveProperty('opportunisticTLS');
  });

  it("verifies the certificate against Node's built-in authorities", () => {
    expect(options['tls']).toEqual({ rejectUnauthorized: true });
  });
});

describe('smtpTransportOptions — a private authority', () => {
  const PEM = '-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----';

  it('trusts the given certificates and keeps verification on', () => {
    for (const port of [25, IMPLICIT_TLS_PORT]) {
      const options = smtpTransportOptions({ ...CONFIG, port, caCertificate: PEM });

      expect(options.tls).toEqual({ rejectUnauthorized: true, ca: PEM });
    }
  });

  it('changes nothing else', () => {
    const { tls: withCa, ...rest } = smtpTransportOptions({ ...CONFIG, caCertificate: PEM });
    const { tls: withoutCa, ...plain } = smtpTransportOptions(CONFIG);

    expect(rest).toEqual(plain);
    expect(withCa).toEqual({ ...withoutCa, ca: PEM });
  });
});

// A relay on the loopback address that never agrees to STARTTLS and records every command it is sent.
async function plaintextOnlyRelay() {
  const commands: string[] = [];
  const server = createServer((socket) => {
    socket.write('220 relay.example.test ESMTP\r\n');
    let buffered = '';
    let inData = false;
    socket.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      let end: number;
      while ((end = buffered.indexOf('\r\n')) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
          }
          continue;
        }
        commands.push(line);
        const verb = line.split(' ')[0]?.toUpperCase();
        if (verb === 'EHLO') socket.write('250-relay.example.test\r\n250 SIZE 1000000\r\n');
        else if (verb === 'STARTTLS') socket.write('502 command not implemented\r\n');
        else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    commands,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('SmtpMailSink — a relay that will not encrypt', () => {
  it('is refused before the envelope or the message is sent', async () => {
    const relay = await plaintextOnlyRelay();
    try {
      const sink = new SmtpMailSink({ ...CONFIG, host: '127.0.0.1', port: relay.port }, clock);

      const failure = await sink.submit(MAIL).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(MailSubmissionError);
      expect(relay.commands.some((line) => /^STARTTLS$/i.test(line))).toBe(true);
      expect(relay.commands.filter((line) => /^(MAIL|RCPT|DATA)\b/i.test(line))).toEqual([]);
    } finally {
      await relay.close();
    }
  });
});

describe('smtpTransportOptions — the relay is not allowed to hang the caller', () => {
  const options = smtpTransportOptions(CONFIG) as Record<string, unknown>;

  it('bounds the TCP connect, so an unreachable host fails fast', () => {
    expect(options['connectionTimeout']).toBe(SMTP_TIMEOUTS.connectionTimeout);
  });

  it('bounds the wait for the SMTP greeting', () => {
    expect(options['greetingTimeout']).toBe(SMTP_TIMEOUTS.greetingTimeout);
  });

  it('bounds socket inactivity — chiefly the post-DATA queue write', () => {
    expect(options['socketTimeout']).toBe(SMTP_TIMEOUTS.socketTimeout);
  });

  it('leaves no timeout to a nodemailer default', () => {
    for (const key of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
      expect(options[key], `${key} unset — falls back to a multi-minute default`).toEqual(
        expect.any(Number),
      );
    }
  });

  it('keeps the whole retry budget inside half a minute', () => {
    const worstCase =
      DEFAULT_RETRY_POLICY.attempts * SMTP_TIMEOUTS.connectionTimeout +
      DEFAULT_RETRY_POLICY.delaysMs.reduce((a, b) => a + b, 0);

    expect(worstCase).toBeLessThanOrEqual(30_000);
  });
});

describe('composeMessage — envelope sender independent of From:', () => {
  const messageId = newMessageId(CONFIG.fromAddress);
  const message = composeMessage(MAIL, CONFIG, messageId);

  it('sets the visible From: to the sending address', () => {
    expect(message.from).toBe('erp@example.test');
  });

  it('sets the envelope sender to the monitored return path, not the From:', () => {
    expect(message.envelope.from).toBe('erp-bounces@example.test');
  });

  it('delivers to every recipient on the envelope, cc included', () => {
    expect(message.envelope.to).toEqual(['customer@example.com', 'sales@example.test']);
  });

  it('stamps our correlation Message-ID into the message', () => {
    expect(message.messageId).toBe(messageId);
  });

  it('carries the attachment bytes and declared type', () => {
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments?.[0]).toMatchObject({
      filename: 'quote-q-3187.pdf',
      contentType: 'application/pdf',
    });
  });
});

describe('newMessageId', () => {
  it('is RFC 5322-shaped with the sender domain', () => {
    expect(newMessageId('erp@example.test')).toMatch(/^<[0-9a-f-]{36}@example\.test>$/);
  });

  it('is unique per call — two documents must never share a correlation id', () => {
    expect(newMessageId('erp@example.test')).not.toBe(newMessageId('erp@example.test'));
  });
});

describe('isPermanentRejection — 5xx only', () => {
  it.each([
    [500, true],
    [550, true],
    [599, true],
    [421, false],
    [450, false],
    [250, false],
    [600, false],
    [499, false],
  ])('responseCode %i -> permanent=%s', (code, expected) => {
    expect(isPermanentRejection(Object.assign(new Error('smtp'), { responseCode: code }))).toBe(
      expected,
    );
  });

  it('treats an error with no response code as retryable', () => {
    expect(isPermanentRejection(new Error('ECONNREFUSED'))).toBe(false);
    expect(isPermanentRejection(Object.assign(new Error('t'), { code: 'ETIMEDOUT' }))).toBe(false);
  });

  it('does not crash on a non-error throw', () => {
    for (const junk of [undefined, null, 'boom', 42, {}]) {
      expect(isPermanentRejection(junk)).toBe(false);
    }
  });

  it('ignores a non-numeric response code', () => {
    expect(isPermanentRejection(Object.assign(new Error('x'), { responseCode: '550' }))).toBe(
      false,
    );
  });
});

describe('SmtpMailSink.submit', () => {
  it('marks a 5xx from the relay as permanent', async () => {
    const rejection = Object.assign(new Error('Recipient rejected'), { responseCode: 550 });
    const { transporter } = fakeTransporter(rejection);
    const sink = new SmtpMailSink(CONFIG, clock, transporter);

    const failure = await sink.submit(MAIL).catch((e: unknown) => e);

    expect((failure as MailSubmissionError).permanent).toBe(true);
  });

  it('leaves a connection failure retryable', async () => {
    const { transporter } = fakeTransporter(new Error('ECONNREFUSED'));
    const sink = new SmtpMailSink(CONFIG, clock, transporter);

    const failure = await sink.submit(MAIL).catch((e: unknown) => e);

    expect((failure as MailSubmissionError).permanent).toBe(false);
  });

  it('returns the minted messageId and the submission time', async () => {
    const { transporter, calls } = fakeTransporter();
    const sink = new SmtpMailSink(CONFIG, clock, transporter);

    const submission = await sink.submit(MAIL);

    expect(submission.acceptedByRelayAt).toEqual(FIXED_NOW);
    expect(submission.messageId).toMatch(/^<[0-9a-f-]{36}@example\.test>$/);
    expect(calls[0]?.['messageId']).toBe(submission.messageId);
  });

  it('stamps a supplied id into the message instead of minting', async () => {
    const { transporter, calls } = fakeTransporter();
    const sink = new SmtpMailSink(CONFIG, clock, transporter);

    const submission = await sink.submit(MAIL, '<fixed@example.test>');

    expect(calls[0]?.['messageId']).toBe('<fixed@example.test>');
    expect(submission.messageId).toBe('<fixed@example.test>');
  });

  it('mints ids carrying the configured sender domain', () => {
    const sink = new SmtpMailSink(CONFIG, clock, fakeTransporter().transporter);

    expect(sink.mintMessageId()).toMatch(/^<[0-9a-f-]{36}@example\.test>$/);
  });

  it('wraps a transport failure in MailSubmissionError naming the relay', async () => {
    const { transporter } = fakeTransporter(new Error('ECONNREFUSED'));
    const sink = new SmtpMailSink(CONFIG, clock, transporter);

    await expect(sink.submit(MAIL)).rejects.toThrowError(MailSubmissionError);
    await expect(sink.submit(MAIL)).rejects.toThrow('mail.example.test:25');
  });
});
