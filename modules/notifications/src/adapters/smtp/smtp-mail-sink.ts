// The `MailSink` that submits to an SMTP relay through nodemailer. A 5xx reply is a permanent
// rejection. Anything else is treated as transient and left to modules/notifications/src/retrying-mail-sink.ts.
import { createTransport, type Transporter } from 'nodemailer';

import { composeMessage, newMessageId, type SenderIdentity } from '../../message';
import {
  MailSubmissionError,
  type Clock,
  type MailSink,
  type MailSubmission,
  type OutboundEmail,
} from '../../ports';

export interface SmtpMailSinkConfig extends SenderIdentity {
  host: string;
  port: number;

  // PEM certificates to trust for the relay instead of Node's built-in certificate authorities, for a relay whose
  // certificate comes from a private authority. Verification stays on either way.
  caCertificate?: string;
}

// Port 465 is SMTP over implicit TLS. Every other port must upgrade with STARTTLS.
export const IMPLICIT_TLS_PORT = 465;

export type SmtpTlsMode = 'implicit-tls' | 'starttls-required';

export function smtpTlsMode(port: number): SmtpTlsMode {
  return port === IMPLICIT_TLS_PORT ? 'implicit-tls' : 'starttls-required';
}

export const SMTP_TIMEOUTS = {
  connectionTimeout: 5_000,
  greetingTimeout: 5_000,
  socketTimeout: 20_000,
} as const;

/**
 * Every connection is encrypted and the relay's certificate is verified, or nothing is sent.
 * Port 465 opens with TLS. Any other port must accept STARTTLS before the first command that carries
 * mail, and a relay that does not offer it is refused. The certificate must chain to Node's built-in
 * certificate authorities, or to `caCertificate` when one is given, and must name the host.
 * `rejectUnauthorized` is set explicitly so that NODE_TLS_REJECT_UNAUTHORIZED cannot turn
 * verification off for this transport.
 * Every timeout is explicit, so an unreachable relay fails fast instead of waiting on a library
 * default. modules/notifications/test/smtp-mail-sink.test.ts pins each option.
 */
export function smtpTransportOptions(config: SmtpMailSinkConfig) {
  const implicitTls = smtpTlsMode(config.port) === 'implicit-tls';
  return {
    host: config.host,
    port: config.port,
    secure: implicitTls,
    ...(implicitTls ? {} : { requireTLS: true }),
    tls: {
      rejectUnauthorized: true,
      ...(config.caCertificate === undefined ? {} : { ca: config.caCertificate }),
    },
    ...SMTP_TIMEOUTS,
  };
}

export function isPermanentRejection(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('responseCode' in cause)) return false;
  const code = (cause as { responseCode: unknown }).responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
}

export class SmtpMailSink implements MailSink {
  private readonly transporter: Transporter;
  private readonly config: SmtpMailSinkConfig;
  private readonly clock: Clock;

  constructor(
    config: SmtpMailSinkConfig,
    clock: Clock,

    transporter: Transporter = createTransport(smtpTransportOptions(config)),
  ) {
    this.config = config;
    this.clock = clock;
    this.transporter = transporter;
  }

  mintMessageId(): string {
    return newMessageId(this.config.fromAddress);
  }

  async submit(mail: OutboundEmail, messageId = this.mintMessageId()): Promise<MailSubmission> {
    try {
      await this.transporter.sendMail(composeMessage(mail, this.config, messageId));
    } catch (cause) {
      throw new MailSubmissionError(
        `relay at ${this.config.host}:${this.config.port} did not accept the message`,
        1,
        cause,
        isPermanentRejection(cause),
      );
    }
    return { messageId, acceptedByRelayAt: this.clock.now() };
  }
}
