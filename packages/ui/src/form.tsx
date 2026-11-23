// Native form controls and the two button kinds. Forms post to server actions, so a button submits by default:
// docs/decisions/004-server-first-web-ui.md. apps/web may not render a raw button: packages/config/eslint/web-ui.mjs.
import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

import { COLOR, FACE_CLASS, FONT_SIZE, SPACE } from './tokens';

export function Field({ children }: { children: ReactNode }) {
  return <label style={{ display: 'grid', gap: SPACE.hair }}>{children}</label>;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: FONT_SIZE.sm, color: COLOR.muted }}>{children}</span>;
}

export function FieldRow({
  children,
  align = 'start',
  style,
}: {
  children: ReactNode;
  align?: 'start' | 'end';
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: `${SPACE.md} ${SPACE.lg}`,
        alignItems: align === 'end' ? 'flex-end' : 'flex-start',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const CHECKBOX_BASELINE_OFFSET = SPACE.md;

export function CheckboxLabel({
  children,
  align = 'center',
}: {
  children: ReactNode;
  align?: 'center' | 'bottom';
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        gap: SPACE.xs,
        alignItems: 'center',
        color: COLOR.muted,
        ...(align === 'bottom'
          ? { alignSelf: 'flex-end', paddingBottom: CHECKBOX_BASELINE_OFFSET }
          : {}),
      }}
    >
      {children}
    </label>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: FONT_SIZE.xs, color: COLOR.muted, maxWidth: 280 }}>{children}</span>
  );
}

export function Input({ style, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} style={{ padding: '0.35rem 0.5rem', fontFamily: 'inherit', ...style }} />;
}

export function Select({ style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} style={{ padding: '0.35rem 0.5rem', fontFamily: 'inherit', ...style }} />
  );
}

export function Button({
  children,
  variant = 'secondary',
  type = 'submit',
  disabled = false,
  name,
  value,
  form,
  formAction,
  ariaLabel,
  ariaPressed,
  style,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  type?: 'submit' | 'button' | 'reset';
  disabled?: boolean;
  name?: string;
  value?: string;

  form?: string;

  formAction?: (formData: FormData) => void | Promise<void>;

  ariaLabel?: string;

  ariaPressed?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      name={name}
      value={value}
      form={form}
      formAction={formAction}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={faceClass(variant, disabled)}
      style={{ ...BUTTON_BOX, ...variantStyle(variant, disabled), ...style }}
    >
      {children}
    </button>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const BUTTON_BOX = { padding: '0.35rem 0.75rem', fontFamily: 'inherit' } as const;

// The browser's own button metrics, so a designed face and a `LinkButton` line up with a plain button beside them.
const NATIVE_BUTTON = {
  fontSize: '13.3333px',
  padding: 'calc(0.35rem + 1px) calc(0.75rem + 1px)',
  radius: 2,
  border: '1px solid light-dark(color-mix(in srgb, ButtonText 51%, ButtonFace), ButtonFace)',
} as const;

function variantStyle(variant: ButtonVariant, disabled = false): CSSProperties {
  const fontWeight = variant === 'primary' ? 600 : undefined;
  if (variant === 'secondary' || disabled) return { fontWeight };
  const face = COLOR[`${variant}Face`];
  return {
    fontWeight,
    color: COLOR[`${variant}Text`],
    background: face,
    border: `1px solid ${face}`,
    borderRadius: NATIVE_BUTTON.radius,
    padding: NATIVE_BUTTON.padding,
  };
}

// A disabled button keeps the browser face, so it never looks like a live primary act.
function faceClass(variant: ButtonVariant, disabled: boolean): string | undefined {
  return variant === 'secondary' || disabled ? undefined : FACE_CLASS[variant];
}

/**
 * A link drawn as a button, for an act that navigates. It is a plain anchor, so it loads a full page:
 * docs/decisions/004-server-first-web-ui.md.
 */
export function LinkButton({
  href,
  children,
  variant = 'secondary',
  style,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  style?: CSSProperties;
}) {
  return (
    <a
      href={href}
      className={faceClass(variant, false)}
      style={{
        ...BUTTON_BOX,

        color: 'ButtonText',
        display: 'inline-block',
        padding: NATIVE_BUTTON.padding,
        background: 'ButtonFace',
        border: NATIVE_BUTTON.border,
        borderRadius: NATIVE_BUTTON.radius,
        fontSize: NATIVE_BUTTON.fontSize,
        textDecoration: 'none',
        ...variantStyle(variant),
        ...style,
      }}
    >
      {children}
    </a>
  );
}
