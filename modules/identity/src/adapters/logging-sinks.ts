// The audit and alert sinks the API wires: one JSON line per event on the console. Audit events go to
// standard output and alerts to standard error. Events are defined in modules/identity/src/ports.ts.
import type { Alert, AlertSink, AuditEvent, AuditSink } from '../ports';

export class ConsoleAuditSink implements AuditSink {
  async record(event: AuditEvent): Promise<void> {
    console.info(JSON.stringify({ kind: 'audit', ...event, at: event.at.toISOString() }));
  }
}

export class ConsoleAlertSink implements AlertSink {
  async raise(alert: Alert): Promise<void> {
    console.warn(
      JSON.stringify({
        kind: 'alert',
        event: alert.type === 'break-glass.used' ? 'break_glass_used' : 'break_glass_locked_out',
        message: alert.message,
        at: alert.at.toISOString(),
      }),
    );
  }
}
