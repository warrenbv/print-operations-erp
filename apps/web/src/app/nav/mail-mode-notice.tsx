// Draws the mail diversion sentence under the top bar. The words are in apps/web/src/app/nav/mail-mode.ts.
import type { MailRedirectView } from '@erp/types';
import { COLOR, FONT_SIZE, SPACE } from '@erp/ui';

import { mailModeSentence } from './mail-mode';

export function MailModeNotice({ redirect }: { redirect: MailRedirectView | null }) {
  const sentence = mailModeSentence(redirect);
  if (sentence === undefined) {
    return null;
  }
  return (
    <p role="note" style={noticeStyle}>
      {sentence}
    </p>
  );
}

const noticeStyle = {
  margin: 0,
  padding: `${SPACE.md} ${SPACE.xxxl}`,
  borderTop: `1px solid ${COLOR.border}`,
  color: COLOR.warning,
  fontSize: FONT_SIZE.sm,
  fontWeight: 600,
} as const;
