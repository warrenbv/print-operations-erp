// Tells the web app whether outbound mail is redirected, and where to, so a page can say where a send will really go.
import { RedirectingMailSink, type MailSink } from '@erp/notifications';
import { Controller, Get, Inject } from '@nestjs/common';
import { mailModeResponseSchema, type MailModeResponse } from '@erp/types';

import { Authenticated } from '../auth/authz.decorators';
import { MAIL_SINK } from './notifications.factory';

@Controller('notifications/mail-mode')
export class MailModeController {
  constructor(@Inject(MAIL_SINK) private readonly mail: MailSink) {}

  @Authenticated()
  @Get()
  mode(): MailModeResponse {
    const redirect = this.mail instanceof RedirectingMailSink ? this.mail.redirect : null;
    return mailModeResponseSchema.parse({
      redirect: redirect === null ? null : { to: redirect.to, allow: [...redirect.allow] },
    });
  }
}
