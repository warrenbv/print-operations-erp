// Wires the Approvals queue over the quoting services.
import { Module } from '@nestjs/common';

import { QuotingModule } from '../quoting/quoting.module';
import { ApprovalsController } from './approvals.controller';

@Module({
  imports: [QuotingModule],
  controllers: [ApprovalsController],
})
export class ApprovalsModule {}
