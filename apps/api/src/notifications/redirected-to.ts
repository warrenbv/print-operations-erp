// The addresses a send really went to when mail is redirected, or undefined when nothing was diverted.
import { RedirectingMailSink, redirectRecipients, type MailSink } from '@erp/notifications';

export function redirectedTo(mail: MailSink, to: readonly string[]): readonly string[] | undefined {
  if (!(mail instanceof RedirectingMailSink)) {
    return undefined;
  }
  const result = redirectRecipients({ to }, mail.redirect);
  return result.diverted.length === 0 ? undefined : result.to;
}
