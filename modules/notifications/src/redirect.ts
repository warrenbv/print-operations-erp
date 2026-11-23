// Test-mode redirect. Mail to anyone not on the allow list goes to one catch-all mailbox instead, and
// the subject names who it was meant for. The API turns it on from `MAIL_REDIRECT_TO` and
// `MAIL_REDIRECT_ALLOW` in apps/api/src/notifications/notifications.factory.ts.
import type { MailSink, MailSubmission, OutboundEmail } from './ports';

export interface MailRedirect {
  readonly to: string;

  readonly allow: readonly string[];
}

export interface RedirectedRecipients {
  readonly to: readonly string[];

  readonly cc?: readonly string[];

  readonly diverted: readonly string[];
}

export interface RedirectPlan {
  readonly mail: OutboundEmail;

  readonly diverted: readonly string[];
}

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function redirectRecipients(
  recipients: { readonly to: readonly string[]; readonly cc?: readonly string[] },
  redirect: MailRedirect,
): RedirectedRecipients {
  const allowed = (address: string): boolean =>
    redirect.allow.some((entry) => sameAddress(entry, address));
  const diverted: string[] = [];

  const keep = (addresses: readonly string[]): string[] => {
    const kept: string[] = [];
    for (const address of addresses) {
      if (allowed(address)) {
        kept.push(address);
      } else if (!diverted.some((seen) => sameAddress(seen, address))) {
        diverted.push(address);
      }
    }
    return kept;
  };

  const to = keep(recipients.to);
  const cc = recipients.cc === undefined ? undefined : keep(recipients.cc);

  if (
    diverted.length > 0 &&
    ![...to, ...(cc ?? [])].some((address) => sameAddress(address, redirect.to))
  ) {
    to.push(redirect.to);
  }

  return { to, ...(cc === undefined ? {} : { cc }), diverted };
}

export function planRedirect(mail: OutboundEmail, redirect: MailRedirect): RedirectPlan {
  const { to, cc, diverted } = redirectRecipients(mail, redirect);

  if (diverted.length === 0) {
    return { mail, diverted };
  }

  return {
    mail: {
      ...mail,
      to,
      ...(cc === undefined ? {} : { cc }),
      subject: `[TEST, was to: ${diverted.join(', ')}] ${mail.subject}`,
    },
    diverted,
  };
}

/**
 * Wraps the retrying sink, not the other way round, so the message is rewritten once and a retry
 * resends that copy instead of prefixing the subject again.
 */
export class RedirectingMailSink implements MailSink {
  constructor(
    private readonly inner: MailSink,
    readonly redirect: MailRedirect,
  ) {}

  mintMessageId(): string {
    return this.inner.mintMessageId();
  }

  plan(mail: OutboundEmail): RedirectPlan {
    return planRedirect(mail, this.redirect);
  }

  submit(mail: OutboundEmail, messageId?: string): Promise<MailSubmission> {
    return this.inner.submit(this.plan(mail).mail, messageId);
  }
}
