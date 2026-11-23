// The opening sentences of Your work: the day and time, what needs you, and what waits on another desk.
// The time is in the business time zone, `BUSINESS_TIMEZONE` from @erp/types, not the server's.
import { BUSINESS_TIMEZONE } from '@erp/types';

export interface NeedYou {
  readonly quotes: number;
  readonly orders: number;

  readonly exceptions?: number;
}

export interface WaitingElsewhere {
  readonly count: number;

  readonly late: readonly string[];
}

export interface LedeInput {
  readonly now: Date;
  readonly needYou: NeedYou;

  readonly another: WaitingElsewhere | null;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function countWord(count: number): string {
  return WORDS[count] ?? String(count);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function counted(count: number, noun: string): string {
  return `${countWord(count)} ${noun}${count === 1 ? '' : 's'}`;
}

const STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function stamp(now: Date): string {
  const parts = new Map(STAMP.formatToParts(now).map((part) => [part.type, part.value]));
  const at = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? '';
  return `${at('weekday')} ${at('day')} ${at('month')}, ${at('hour')}:${at('minute')} ${at('dayPeriod')}.`;
}

function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

export function needYouSentence(needYou: NeedYou): string {
  const kinds: readonly [number, string][] = [
    [needYou.quotes, 'quote'],
    [needYou.orders, 'order'],
    [needYou.exceptions ?? 0, 'exception'],
  ];
  const present = kinds.filter(([count]) => count > 0);
  if (present.length === 0) return 'Nothing is waiting on you.';
  const total = present.reduce((sum, [count]) => sum + count, 0);
  const parts = present.map(([count, noun]) => counted(count, noun));
  return `${capitalise(listed(parts))} ${total > 1 ? 'need' : 'needs'} you.`;
}

export function anotherDeskSentence({ count, late }: WaitingElsewhere): string | null {
  if (count === 0) return null;
  const head = `${capitalise(countWord(count))} ${count === 1 ? 'waits' : 'wait'} on another desk`;
  const oldest = late[0];
  if (oldest === undefined) return `${head}.`;
  if (count === 1) return `${head}, and it has waited ${oldest}.`;
  return late.length === 1
    ? `${head}, and one of those has waited ${oldest}.`
    : `${head}, and the oldest has waited ${oldest}.`;
}

// Keyed by the paths apps/web/src/lib/work/load-workbook.ts reads, so a refused read is named in words.
const LIST_NAMES: Readonly<Record<string, string>> = {
  '/quoting/quotes': 'quotes',
  '/orders': 'orders',
  '/approvals/pending': 'approvals',
  '/crm/customers': 'credit holds',
};

export function listName(path: string): string {
  const bare = path.split('?')[0] ?? path;
  return LIST_NAMES[bare] ?? bare.split('/').filter(Boolean).at(-1) ?? bare;
}

export function refusedSentence(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const names = [...new Set(paths.map(listName))];
  return `Some queues could not be read just now: ${names.join(', ')}. Every page is still here below.`;
}

export function ledeFor({ now, needYou, another }: LedeInput): string {
  const elsewhere = another === null ? null : anotherDeskSentence(another);
  return [stamp(now), needYouSentence(needYou), ...(elsewhere === null ? [] : [elsewhere])].join(
    ' ',
  );
}
