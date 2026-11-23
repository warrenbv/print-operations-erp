# Notifications module

## What it is responsible for

This module sends the system's email and keeps one log of every send. Mail goes through a `MailSink` port: a console sink when mail is not configured or storage is in memory, as in the demo, and an SMTP relay otherwise. The send log records each message, and each attempt that could not be sent, against the quote or order it was about.

## Public surface

Other code imports only from `@erp/notifications`, which is [src/index.ts](src/index.ts):

- The ports `MailSink` and `SendLog`, the `OutboundEmail` shape and `MailSubmissionError`.
- The sinks: `SmtpMailSink`, `ConsoleMailSink` and `InMemoryMailSink`, and the wrappers `RetryingMailSink` and `RedirectingMailSink`.
- The send logs: `DrizzleSendLog` and `InMemorySendLog`, with `createNotificationsDb`.
- `composeMessage` and `newMessageId`, which build the message and its correlation id.
- `smtpTransportOptions` and `smtpTlsMode`, which decide how the connection to the relay is protected.

Nothing may import from `src/` directly: [packages/config/eslint/boundaries.mjs](../../packages/config/eslint/boundaries.mjs). The module composes no message text and decides nobody's recipients. The API does both. The wiring is [apps/api/src/notifications/notifications.factory.ts](../../apps/api/src/notifications/notifications.factory.ts), and every send passes through [apps/api/src/notifications/submit-and-record.ts](../../apps/api/src/notifications/submit-and-record.ts).

## State it owns

- The PostgreSQL schema `notifications` with one table, `send_log`. A row is appended for every send and every failed attempt and never updated. It is keyed to its quote or order by subject type and id, with no foreign key. Schema in [src/data/schema.ts](src/data/schema.ts). Migration in [infra/db/migrations/notifications/0000_baseline.sql](../../infra/db/migrations/notifications/0000_baseline.sql), whose hand-written CHECK constraints hold the subject types, audiences, outcomes and failure reasons to the values in [packages/types/src/send-log.ts](../../packages/types/src/send-log.ts).

It owns no state machine.

## Rules it enforces

- Every message the system sends is recorded in one log owned by this module. See One send log in [docs/decisions/README.md](../../docs/decisions/README.md).
- One send carries one Message-ID through every retry, so the log and the relay's records can be matched.
- A transient relay failure is retried on a fixed backoff. A permanent rejection is not retried.
- No relay call may hang the request. Every SMTP timeout is set explicitly.
- The connection to the relay is always encrypted and the relay's certificate is always verified. Port 465 opens with TLS. Any other port must accept STARTTLS, and a relay that does not offer it is refused before the envelope is sent. The certificate must name the relay's host and chain to Node's built-in certificate authorities, or to the certificates in `SMTP_CA_FILE` for a relay whose certificate comes from a private authority. No setting turns either check off.
- The module protects the hop to the relay and nothing past it. It sends no credentials to the relay, and how the relay delivers onward is the relay's own configuration.
- In test mode, mail to anyone not on the allow list goes to one catch-all mailbox, with the original recipients named in the subject.

The quote email that Review and send sends, [docs/product/requirements.md](../../docs/product/requirements.md) (R8), goes through this module. In the demo it is written to the launcher console by the console sink.

## Where to start reading

- [src/ports.ts](src/ports.ts): the two ports and what each promises.
- [src/retrying-mail-sink.ts](src/retrying-mail-sink.ts): retries, permanent rejections and the structured log lines.
- [src/adapters/smtp/smtp-mail-sink.ts](src/adapters/smtp/smtp-mail-sink.ts): the relay connection's encryption, certificate check and timeouts, and how a 5xx is classified.
- [src/redirect.ts](src/redirect.ts): the test-mode redirect.
- [src/adapters/drizzle/drizzle-send-log.ts](src/adapters/drizzle/drizzle-send-log.ts): the queries behind "was this sent, and when".

## Tests

- Unit tests cover the retrying sink, the redirect, the SMTP options and message composition, with a fake transporter and the in-memory sink. One test sends to a relay on the loopback address that refuses STARTTLS, and checks that nothing past the refusal is sent.
- [test/smtp-relay-tls.test.ts](test/smtp-relay-tls.test.ts) sends to relays on the loopback address that speak TLS, with a certificate generated for the run. A certificate that does not chain to a trusted authority stops the send before the envelope, on the STARTTLS and on the implicit TLS path. On the STARTTLS path so does a trusted certificate that names another host, and so does an untrusted one with `NODE_TLS_REJECT_UNAUTHORIZED=0` set. Once the relay is trusted through `caCertificate`, the envelope and the message go only over the encrypted connection.
- A contract suite in [test/contracts/](test/contracts/) runs one set of assertions against the in-memory and the PostgreSQL send log, including ordering and tie-breaks.

`pnpm test` runs everything except the PostgreSQL send-log run, which skips without a database. `pnpm test:db` runs the same suite against a throwaway local Postgres, including that run and the CHECK constraint tests.
