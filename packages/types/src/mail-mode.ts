// What the API reports about mail redirection, so the web app can show where outgoing mail really goes.
// The API side: apps/api/src/notifications/mail-mode.controller.ts.
import { z } from 'zod';

export const mailRedirectViewSchema = z.object({
  to: z.string().min(1),

  allow: z.array(z.string().min(1)),
});

export type MailRedirectView = z.infer<typeof mailRedirectViewSchema>;

export const mailModeResponseSchema = z.object({
  redirect: mailRedirectViewSchema.nullable(),
});

export type MailModeResponse = z.infer<typeof mailModeResponseSchema>;
