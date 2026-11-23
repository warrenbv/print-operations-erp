// The suffix a sent-message notice carries while mail is redirected for testing, naming where the message really went.
// Whether mail is redirected is read by apps/web/src/lib/load-mail-mode.ts.
export function redirectNote(redirectedTo: readonly string[] | undefined): string {
  return redirectedTo === undefined || redirectedTo.length === 0
    ? ''
    : ` (test mode: went to ${redirectedTo.join(', ')})`;
}
