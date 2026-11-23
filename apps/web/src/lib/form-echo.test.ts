// Tests the refused-form echo, including its round trip through a URL.
import { describe, expect, it } from 'vitest';

import { ECHO_PREFIX, echoOf, submitted } from './form-echo';
import { errorUrl } from './redirect-error';

function form(entries: Readonly<Record<string, string>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    data.append(name, value);
  }
  return data;
}

describe('echoOf', () => {
  it('namespaces every kept value', () => {
    const echo = echoOf(form({ carrierBid: '900', freightMode: 'carrier' }), () => true);

    expect(echo).toEqual({ 'was.carrierBid': '900', 'was.freightMode': 'carrier' });
  });

  it('keeps only the form being echoed', () => {
    const echo = echoOf(form({ carrierBid: '900', leadTimeDays: '7' }), (name) =>
      name.startsWith('carrier'),
    );

    expect(echo).toEqual({ 'was.carrierBid': '900' });
  });

  it('leaves empty values out', () => {
    const echo = echoOf(form({ city: 'Example City', state: '' }), () => true);

    expect(echo).toEqual({ 'was.city': 'Example City' });
  });

  it('names the form when a page has more than one that echoes', () => {
    const echo = echoOf(form({ note: 'call before delivery' }), () => true, 'delivery');

    expect(echo).toEqual({ 'was.note': 'call before delivery', 'was.form': 'delivery' });
  });

  it('does not name a form when nothing was kept', () => {
    expect(echoOf(form({ note: '' }), () => true, 'delivery')).toEqual({});
  });

  it('drops the echo whole rather than build an unsendable URL', () => {
    const long: Record<string, string> = {};
    for (let i = 0; i < 60; i += 1) {
      long[`lines[${i}].delivery.line1`] = 'x'.repeat(90);
    }

    expect(echoOf(form(long), () => true)).toEqual({});
  });
});

describe('submitted', () => {
  it('strips the namespace and ignores everything else', () => {
    const values = submitted({
      error: 'Line 1: a taxable line needs a tax jurisdiction.',
      field: 'carrierBid',
      'was.carrierBid': '900',
    });

    expect(values).toEqual({ carrierBid: '900' });
  });

  it('is empty on an ordinary page load', () => {
    expect(submitted({ notice: 'Lead time saved: 7 days.' })).toEqual({});
  });

  it('skips a key that arrived twice', () => {
    expect(submitted({ 'was.carrierBid': ['900', '950'] })).toEqual({});
  });

  it('leaves the form marker out of the values', () => {
    expect(submitted({ 'was.form': 'delivery', 'was.note': 'call before delivery' })).toEqual({
      note: 'call before delivery',
    });
  });
});

describe('the round trip through a URL', () => {
  it('survives the line form bracketed, dotted names', () => {
    const echo = echoOf(
      form({
        'lines[0].gradeId': 'kraft-40',

        'lines[0].delivery.name': 'Port & Dock Two',
        'lines[0].overwrap': 'on',
      }),
      (name) => name.startsWith('lines['),
    );

    const url = errorUrl('/quoting/quotes/q1', 'Line 1: a delivery address needs a street.', echo);
    const query = new URL(url, 'http://erp.example.test').searchParams;
    const params: Record<string, string> = {};
    query.forEach((value, key) => {
      params[key] = value;
    });

    expect(url).not.toContain('[0]');
    expect(url).toContain(`${encodeURIComponent(`${ECHO_PREFIX}lines[0].gradeId`)}=kraft-40`);

    expect(submitted(params)).toEqual({
      'lines[0].gradeId': 'kraft-40',
      'lines[0].delivery.name': 'Port & Dock Two',
      'lines[0].overwrap': 'on',
    });
  });
});
