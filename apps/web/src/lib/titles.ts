// The browser tab title pattern: the page's title, then the application name.
export const APP_NAME = 'Print Operations ERP';

export const TITLE_TEMPLATE = `%s | ${APP_NAME}`;

export function fullTitle(title: string): string {
  // A replacer function, so a `$` in a record's name is not read as a replacement pattern.
  return TITLE_TEMPLATE.replace('%s', () => title);
}
