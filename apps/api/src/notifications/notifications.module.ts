// Wires notifications. Quoting, orders and the Admin section share its mail sink and send log.
import { consoleMailLog } from '@erp/notifications';
import { Module } from '@nestjs/common';

import { IDENTITY_STORES } from '../auth/auth.factory';
import { AuthModule } from '../auth/auth.module';
import {
  MAIL_LOG,
  MAIL_SINK,
  SENDER_NOTIFIER,
  SEND_LOG,
  createMailSink,
  createSendLog,
  createSenderNotifier,
} from './notifications.factory';
import { MailModeController } from './mail-mode.controller';

@Module({
  imports: [AuthModule],
  controllers: [MailModeController],
  providers: [
    { provide: MAIL_LOG, useValue: consoleMailLog },
    { provide: MAIL_SINK, useFactory: () => createMailSink() },

    { provide: SEND_LOG, useFactory: () => createSendLog().log },

    {
      provide: SENDER_NOTIFIER,
      useFactory: createSenderNotifier,
      inject: [MAIL_SINK, SEND_LOG, MAIL_LOG, IDENTITY_STORES],
    },
  ],
  exports: [MAIL_SINK, MAIL_LOG, SEND_LOG, SENDER_NOTIFIER],
})
export class NotificationsModule {}
