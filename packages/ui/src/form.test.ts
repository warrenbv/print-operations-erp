// Tests for the form controls and the two button kinds. Each component is called as a function and its element read.
import { describe, expect, it } from 'vitest';

import { Button, CheckboxLabel, Field, FieldRow, Hint, Input, LinkButton, Select } from './form';
import { COLOR, FACE_CLASS, SPACE } from './tokens';

describe('Field', () => {
  it('wraps its control in the label, so the association cannot go stale', () => {
    expect(Field({ children: null }).type).toBe('label');
  });
});

describe('Input', () => {
  it('inherits the page font, which browsers do not do for controls', () => {
    expect(Input({}).props.style.fontFamily).toBe('inherit');
  });

  it('passes its own attributes straight through', () => {
    const el = Input({ name: 'jobNumber', required: true, maxLength: 64 });
    expect(el.props.name).toBe('jobNumber');
    expect(el.props.required).toBe(true);
    expect(el.props.maxLength).toBe(64);
  });

  it('lets a caller override a style without losing the rest', () => {
    expect(Input({ style: { width: 90 } }).props.style.width).toBe(90);
    expect(Input({ style: { width: 90 } }).props.style.padding).toBe('0.35rem 0.5rem');
  });
});

describe('Select', () => {
  it('inherits the page font, which browsers do not do for controls', () => {
    expect(Select({}).props.style.fontFamily).toBe('inherit');
  });

  it('matches Input, because they sit in the same row', () => {
    expect(Select({}).props.style.padding).toBe(Input({}).props.style.padding);
    expect(Select({}).props.style.fontFamily).toBe(Input({}).props.style.fontFamily);
  });

  it('renders a select, not an input', () => {
    expect(Select({}).type).toBe('select');
  });

  it('passes its own attributes and options straight through', () => {
    const el = Select({ name: 'productFamily', defaultValue: '', required: true });
    expect(el.props.name).toBe('productFamily');
    expect(el.props.defaultValue).toBe('');
    expect(el.props.required).toBe(true);
  });

  it('lets a caller keep a padding it chose on purpose', () => {
    expect(Select({ style: { padding: SPACE.md } }).props.style.padding).toBe(SPACE.md);
    expect(Select({ style: { padding: SPACE.md } }).props.style.fontFamily).toBe('inherit');
  });
});

describe('Button', () => {
  it('submits by default, because these are native forms', () => {
    expect(Button({ children: 'Save' }).props.type).toBe('submit');
  });

  it.each(['primary', 'danger'] as const)('draws a %s action on its own designed face', (v) => {
    const el = Button({ children: 'Go', variant: v });
    expect(el.props.style.background).toBe(COLOR[`${v}Face`]);
    expect(el.props.style.color).toBe(COLOR[`${v}Text`]);
    expect(el.props.style.border).toBe(`1px solid ${COLOR[`${v}Face`]}`);
    expect(el.props.className).toBe(FACE_CLASS[v]);
    expect(el.props.disabled).toBe(false);
  });

  it('keeps a primary action bold', () => {
    expect(Button({ children: 'Send quote', variant: 'primary' }).props.style.fontWeight).toBe(600);
  });

  it('leaves a secondary button on the browser face, with nothing of its own', () => {
    const el = Button({ children: 'Search' });
    expect(el.props.style).toEqual({ padding: '0.35rem 0.75rem', fontFamily: 'inherit' });
    expect(el.props.className).toBeUndefined();
  });

  it('draws no designed face on a disabled button', () => {
    const el = Button({ children: 'Send quote', variant: 'primary', disabled: true });
    expect(el.props.style).toEqual({
      padding: '0.35rem 0.75rem',
      fontFamily: 'inherit',
      fontWeight: 600,
    });
    expect(el.props.className).toBeUndefined();
  });

  it('is enabled unless a caller says otherwise', () => {
    expect(Button({ children: 'Save' }).props.disabled).toBe(false);
  });

  it('marks the current choice only when asked', () => {
    expect(Button({ children: 'Dark', ariaPressed: true }).props['aria-pressed']).toBe(true);
    expect(Button({ children: 'Save' }).props['aria-pressed']).toBeUndefined();
  });
});

describe('LinkButton', () => {
  it('is a plain link, so it navigates with a full document load', () => {
    const el = LinkButton({ href: '/quoting/quotes/q1/convert', children: 'Convert to order' });
    expect(el.type).toBe('a');
    expect(el.props.href).toBe('/quoting/quotes/q1/convert');
    expect(el.props.style.textDecoration).toBe('none');
  });

  it('draws the same designed face as Button', () => {
    for (const variant of ['primary', 'danger'] as const) {
      const link = LinkButton({ href: '/x', children: 'Go', variant });
      const button = Button({ children: 'Go', variant });
      for (const key of [
        'color',
        'background',
        'border',
        'borderRadius',
        'padding',
        'fontWeight',
      ]) {
        expect(link.props.style[key]).toBe(button.props.style[key]);
      }
      expect(link.props.className).toBe(button.props.className);
    }
  });

  it('draws the native face, and names only the granted system colours', () => {
    const style = LinkButton({ href: '/x', children: 'Go' }).props.style;
    expect(style.background).toBe('ButtonFace');
    expect(style.color).toBe('ButtonText');
    const named = JSON.stringify(style).match(/\b[A-Z][a-z]+[A-Z][a-z]+\b/g) ?? [];
    expect(new Set(named)).toEqual(new Set(['ButtonFace', 'ButtonText']));
  });

  it('names no system colour on a primary or danger link, whose face is designed', () => {
    for (const variant of ['primary', 'danger'] as const) {
      const style = LinkButton({ href: '/x', children: 'Go', variant }).props.style;
      for (const value of [style.color, style.background, style.border]) {
        expect(String(value)).not.toMatch(/Button(Face|Text|Border)/);
      }
    }
  });
});

describe('Hint', () => {
  it('stays narrow, so it reads as a note rather than a paragraph', () => {
    expect(Hint({ children: 'Optional.' }).props.style.maxWidth).toBe(280);
  });
});

describe('FieldRow', () => {
  it('lays fields out in a wrapping flex row with the SPACE gaps', () => {
    const { style } = FieldRow({ children: null }).props;
    expect(style.display).toBe('flex');
    expect(style.flexWrap).toBe('wrap');
    expect(style.gap).toBe(`${SPACE.md} ${SPACE.lg}`);
    expect(style.alignItems).toBe('flex-start');
  });

  it('aligns to the top by default', () => {
    expect(FieldRow({ children: null }).props.style.alignItems).toBe('flex-start');
  });

  it('keeps the contact form able to align to the bottom', () => {
    expect(FieldRow({ children: null, align: 'end' }).props.style.alignItems).toBe('flex-end');
  });

  it('is a div, not a label, so it can hold several fields', () => {
    expect(FieldRow({ children: null }).type).toBe('div');
  });

  it('lets a caller add a style without losing the row', () => {
    const { style } = FieldRow({ children: null, style: { marginTop: 12 } }).props;
    expect(style.marginTop).toBe(12);
    expect(style.display).toBe('flex');
  });
});

describe('CheckboxLabel', () => {
  it('is a label, so the caption clicks the box', () => {
    expect(CheckboxLabel({ children: 'Printed' }).type).toBe('label');
  });

  it('sets the caption inline beside the box in the muted colour', () => {
    const { style } = CheckboxLabel({ children: 'Printed' }).props;
    expect(style.display).toBe('inline-flex');
    expect(style.gap).toBe(SPACE.xs);
    expect(style.alignItems).toBe('center');
    expect(style.color).toBe(COLOR.muted);
  });

  it('adds no row offset by default', () => {
    const { style } = CheckboxLabel({ children: 'Printed' }).props;
    expect(style.alignSelf).toBeUndefined();
    expect(style.paddingBottom).toBeUndefined();
  });

  it('drops onto the input baseline on request, on the SPACE scale', () => {
    const { style } = CheckboxLabel({ children: 'Printed', align: 'bottom' }).props;
    expect(style.alignSelf).toBe('flex-end');
    expect(style.paddingBottom).toBe(SPACE.md);
  });

  it('keeps the box centred against its own caption when dropped', () => {
    expect(CheckboxLabel({ children: 'Printed', align: 'bottom' }).props.style.alignItems).toBe(
      'center',
    );
  });
});
