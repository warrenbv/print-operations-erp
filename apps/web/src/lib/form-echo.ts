// Echoes a refused form back to the person who filled it in. The server action redirects with the submitted values
// in the URL under the `was.` prefix, and the page reads them back with `submitted`.
// A page re-renders on the server after a refusal, which would otherwise lose what was typed: docs/decisions/004-server-first-web-ui.md.
export const ECHO_PREFIX = 'was.';

// Names the form an echo belongs to when a page has more than one that echoes.
const ECHO_FORM_KEY = `${ECHO_PREFIX}form`;

const MAX_ECHO_CHARS = 4_000;

/**
 * The echo of a refused form, as query entries. `keep` chooses the fields. Callers leave out what the page
 * must read afresh, such as `lockVersion` (docs/decisions/006-optimistic-concurrency.md) and the submission token.
 * When the echo would make the URL too long it is dropped whole, rather than build a URL too long to send.
 */
export function echoOf(
  formData: FormData,
  keep: (name: string) => boolean,
  formName?: string,
): Record<string, string> {
  const echo: Record<string, string> = {};
  formData.forEach((value, name) => {
    if (typeof value !== 'string' || value === '' || !keep(name)) {
      return;
    }
    echo[`${ECHO_PREFIX}${name}`] = value;
  });

  if (formName !== undefined && Object.keys(echo).length > 0) {
    echo[ECHO_FORM_KEY] = formName;
  }
  return echoFits(echo) ? echo : {};
}

export function echoFits(echo: Readonly<Record<string, string>>): boolean {
  return new URLSearchParams(echo).toString().length <= MAX_ECHO_CHARS;
}

export function submitted(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string' && key !== ECHO_FORM_KEY && key.startsWith(ECHO_PREFIX)) {
      values[key.slice(ECHO_PREFIX.length)] = value;
    }
  }
  return values;
}
