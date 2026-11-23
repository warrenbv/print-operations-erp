// Structural census: every route that mails a document to a customer checks the confirmed recipients, and every web caller sends them.
// The rule: a send goes to the contacts the person saw on the page, or not at all. apps/api/src/crm/confirm-recipient.ts enforces it at the API.
// Routes are found by their call to `assertRecipientConfirmed`. A failure means a new send route, or a caller that does not post
// `confirmRecipients` through the shared helper.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const API_SRC = resolve(__dirname, '../src');
const WEB_SRC = resolve(__dirname, '../../web/src');

const CONFIRM_FIELD = 'confirmRecipients';

function sourceFilesUnder(root: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFilesUnder(path, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

function skeleton(path: string): string {
  return path
    .split('/')
    .filter((part) => part !== '')
    .map((part) => (part.startsWith(':') || part.includes('${') ? '*' : part))
    .join('/');
}

function sendRoutes(): string[] {
  const routes = new Set<string>();
  for (const file of sourceFilesUnder(API_SRC, ['.controller.ts'])) {
    const source = readFileSync(file, 'utf8');

    const prefixes = [...source.matchAll(/^@Controller\('([^']*)'\)/gm)];
    const posts = [...source.matchAll(/^\s*@Post\('([^']*)'\)/gm)];
    posts.forEach((post, index) => {
      const start = post.index ?? 0;

      const end = posts[index + 1]?.index ?? source.length;
      if (!source.slice(start, end).includes('assertRecipientConfirmed')) return;

      const prefix = prefixes.filter((match) => (match.index ?? 0) < start).at(-1)?.[1] ?? '';
      routes.add(skeleton(`${prefix}/${post[1] ?? ''}`));
    });
  }
  return [...routes].sort();
}

function webCallersOf(routes: readonly string[]): string[] {
  const callers: string[] = [];
  for (const file of sourceFilesUnder(WEB_SRC, ['.ts', '.tsx'])) {
    const source = readFileSync(file, 'utf8');
    const calls = [...source.matchAll(/apiFetch\(\s*`([^`]*)`/g)];
    const callsASend = calls.some((call) => {
      const called = skeleton(call[1] ?? '');
      return (
        called !== '' && routes.some((route) => route === called || route.endsWith(`/${called}`))
      );
    });
    if (callsASend) callers.push(relative(WEB_SRC, file).split(sep).join('/'));
  }
  return callers.sort();
}

describe('every send action confirms its recipients', () => {
  const routes = sendRoutes();
  const callers = webCallersOf(routes);

  it('finds the send routes by their confirm step, and there are two', () => {
    expect(routes).toEqual(['orders/*/confirmation', 'quoting/quotes/*/send']);
  });

  it('is not vacuous - every send route has a web caller', () => {
    expect(callers).toEqual([
      'app/orders/[id]/lifecycle-actions.ts',
      'app/quoting/quotes/[id]/actions.ts',
    ]);
  });

  it.each(callers)('%s confirms the recipients', (file) => {
    expect(readFileSync(resolve(WEB_SRC, file), 'utf8')).toContain(CONFIRM_FIELD);
  });

  it.each(callers)('%s builds its body through the shared helper', (file) => {
    expect(readFileSync(resolve(WEB_SRC, file), 'utf8')).toContain('confirmRecipientsBody');
  });
});
