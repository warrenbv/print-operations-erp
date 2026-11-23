// The prefix of the banner a refused send shows. A send the relay took but the ERP did not record
// went out, so its banner does not open with "Could not email".
export function sendRefusalPrefix(reason: string | undefined): string {
  return reason === 'send-not-recorded' ? 'Emailed, but not recorded' : 'Could not email the quote';
}
