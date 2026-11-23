// Tests for ActNow, GateList, ActRow and ButtonReason. Each component is called as a function and its element read.
import { describe, expect, it } from 'vitest';

import { ActNow, ActRow, ButtonReason, GateList, type ActTone } from './act-now';
import { COLOR, FONT_SIZE } from './tokens';

describe('ActNow', () => {
  it.each([
    ['act', COLOR.accent, COLOR.accentSoft],
    ['waiting', COLOR.warning, COLOR.warningSoft],
    ['done', COLOR.success, COLOR.successSoft],
  ] as [ActTone, string, string][])(
    'draws the %s tone in its colour role',
    (tone, border, fill) => {
      const el = ActNow({ tone, title: 'x', children: null });
      expect(el.props.style.border).toBe(`1px solid ${border}`);
      expect(el.props.style.background).toBe(fill);
    },
  );

  it('is a section named by its title, headed by an h2 and the muted who line', () => {
    const el = ActNow({
      tone: 'waiting',
      title: 'Lead time: waiting on Production',
      who: 'Asked 4 days ago',
      id: 'lead-time',
      children: 'body',
    });
    expect(el.type).toBe('section');
    expect(el.props.id).toBe('lead-time');
    expect(el.props['aria-label']).toBe('Lead time: waiting on Production');
    const [head, body] = el.props.children;
    const [h2, who] = head.props.children;
    expect(h2.type).toBe('h2');
    expect(h2.props.children).toBe('Lead time: waiting on Production');
    expect(who.props.children).toBe('Asked 4 days ago');
    expect(who.props.style.color).toBe(COLOR.muted);
    expect(body).toBe('body');
  });

  it('has no head without a title, and takes its name from label', () => {
    const el = ActNow({ tone: 'done', label: 'Lead time', children: 'done line' });
    expect(el.props['aria-label']).toBe('Lead time');
    const [head, body] = el.props.children;
    expect(head).toBe(false);
    expect(body).toBe('done line');
  });

  it('never draws danger', () => {
    for (const tone of ['act', 'waiting', 'done'] as ActTone[]) {
      expect(ActNow({ tone, children: null }).props.style.border).not.toContain(COLOR.danger);
    }
  });
});

describe('GateList', () => {
  const el = GateList({
    gates: [
      { text: 'The lead time is in.', clear: true },
      {
        text: 'Production enters the lead time.',
        clear: false,
        link: { href: '/production/lead-times', label: 'Who does this' },
      },
      { text: 'The customer has an email.', clear: false, href: '/customers/1' },
    ],
  })!;
  const [clear, open, linked] = el.props.children;

  it('ticks a clear gate in success', () => {
    const [glyph] = clear.props.children;
    expect(glyph.props.children).toBe('✓');
    expect(glyph.props.style.color).toBe(COLOR.success);
    expect(glyph.props['aria-hidden']).toBe('true');
  });

  it('marks an open gate with a circle in warning', () => {
    const [glyph] = open.props.children;
    expect(glyph.props.children).toBe('○');
    expect(glyph.props.style.color).toBe(COLOR.warning);
    expect(glyph.props['aria-hidden']).toBe('true');
  });

  it('keeps the words plain without href, and adds the trailing link', () => {
    const [, words] = open.props.children;
    const [text, trailing] = words.props.children;
    expect(text).toBe('Production enters the lead time.');
    const [, a] = trailing.props.children;
    expect(a.type).toBe('a');
    expect(a.props.href).toBe('/production/lead-times');
    expect(a.props.children).toBe('Who does this');
  });

  it('makes the words a link with href', () => {
    const [, words] = linked.props.children;
    const [a, trailing] = words.props.children;
    expect(a.type).toBe('a');
    expect(a.props.href).toBe('/customers/1');
    expect(a.props.children).toBe('The customer has an email.');
    expect(trailing).toBe(false);
  });

  it('renders nothing for no gates', () => {
    expect(GateList({ gates: [] })).toBeNull();
  });
});

describe('ActRow and ButtonReason', () => {
  it('lays the row out as a wrapping flex', () => {
    const el = ActRow({ children: null });
    expect(el.props.style.display).toBe('flex');
    expect(el.props.style.flexWrap).toBe('wrap');
  });

  it('sets the reason muted and small', () => {
    const el = ButtonReason({ children: 'Waits on the lead time.' });
    expect(el.props.style.color).toBe(COLOR.muted);
    expect(el.props.style.fontSize).toBe(FONT_SIZE.sm);
    expect(el.props.children).toBe('Waits on the lead time.');
  });
});
