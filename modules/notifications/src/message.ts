// Builds the message the SMTP sink hands to nodemailer, and the Message-ID that correlates a send.
import { randomUUID } from 'node:crypto';

import type { OutboundEmail } from './ports';

export interface SenderIdentity {
  fromAddress: string;
  returnPath: string;
}

export function newMessageId(fromAddress: string): string {
  const at = fromAddress.lastIndexOf('@');
  const domain = at === -1 ? 'erp.invalid' : fromAddress.slice(at + 1);
  return `<${randomUUID()}@${domain}>`;
}

/**
 * The envelope sender is the return path, not the From address, so bounces go to their own mailbox.
 * Cc recipients are on the envelope too.
 */
export function composeMessage(mail: OutboundEmail, sender: SenderIdentity, messageId: string) {
  return {
    messageId,
    from: sender.fromAddress,
    to: [...mail.to],
    ...(mail.cc === undefined ? {} : { cc: [...mail.cc] }),
    subject: mail.subject,
    text: mail.textBody,
    ...(mail.attachments === undefined
      ? {}
      : {
          attachments: mail.attachments.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            content: Buffer.from(a.bytes),
          })),
        }),
    envelope: {
      from: sender.returnPath,
      to: [...mail.to, ...(mail.cc ?? [])],
    },
  };
}
