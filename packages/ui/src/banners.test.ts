// Tests for the banners and their shared empty guard. Each component is called as a function and its element read.
import { describe, expect, it } from 'vitest';

import { DangerBanner, ErrorBanner, InfoBanner, WarnBanner } from './banners';
import { COLOR } from './tokens';

describe('ErrorBanner', () => {
  it('renders nothing when the message is empty', () => {
    expect(ErrorBanner({ message: '' })).toBeNull();
    expect(ErrorBanner({ message: undefined })).toBeNull();
  });

  it('announces itself when there is a message', () => {
    const el = ErrorBanner({ message: 'Grade is required.' });
    expect(el).not.toBeNull();
    expect(el?.props.role).toBe('alert');
    expect(el?.props.children).toBe('Grade is required.');
  });

  it('colours the text with the danger token, not a literal', () => {
    const el = ErrorBanner({ message: 'boom' });
    expect(el?.props.style.color).toBe(COLOR.danger);
  });
});

describe('the non-error banners', () => {
  it('does not announce a warning, because it is read in place', () => {
    const el = WarnBanner({ children: 'Freight is estimated.' });
    expect(el?.props.role).toBeUndefined();
    expect(el?.props.style.color).toBe(COLOR.warning);
  });

  it('leaves an info banner in the default text colour', () => {
    const el = InfoBanner({ children: 'Nothing to approve.' });
    expect(el).not.toBeNull();
    expect(el?.props.role).toBeUndefined();
    expect(el?.props.style.color).toBeUndefined();
    expect(el?.props.style.border).toContain(COLOR.accent);
  });
});

describe('the empty guard', () => {
  const empty = [
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],

    ['false', false],
  ] as const;

  it.each(empty)('InfoBanner renders nothing for %s', (_label, children) => {
    expect(InfoBanner({ children })).toBeNull();
  });

  it.each(empty)('WarnBanner renders nothing for %s', (_label, children) => {
    expect(WarnBanner({ children })).toBeNull();
  });

  it.each(empty)('DangerBanner renders nothing for %s', (_label, children) => {
    expect(DangerBanner({ children })).toBeNull();
  });

  it('still renders a banner for a zero, which is a real message', () => {
    expect(InfoBanner({ children: 0 })).not.toBeNull();
  });
});

describe('DangerBanner', () => {
  it('announces itself, because it is a failure like ErrorBanner', () => {
    const el = DangerBanner({ children: 'Cancelled by dana.' });
    expect(el?.props.role).toBe('alert');
  });

  it('carries the danger token on the text and the border', () => {
    const el = DangerBanner({ children: 'boom' });
    expect(el?.props.style.color).toBe(COLOR.danger);
    expect(el?.props.style.border).toContain(COLOR.danger);
  });

  it('takes markup, which is the whole reason it exists beside ErrorBanner', () => {
    const children = ['Cancelled', ' by dana'];
    const el = DangerBanner({ children });
    expect(el?.props.children).toBe(children);
  });
});
