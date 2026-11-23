// The declarative document a template builds and a renderer draws. Templates decide content and the
// renderer decides layout. See Document rendering in docs/decisions/README.md.
// Templates: modules/documents/src/templates.
// Renderer: modules/documents/src/adapters/react-pdf/react-pdf-renderer.tsx.
interface HeadingBlock {
  type: 'heading';
  title: string;

  subtitle?: string;
}

export interface KeyValuesBlock {
  type: 'keyValues';
  heading?: string;
  rows: readonly { label: string; value: string }[];
}

export interface LineItemsBlock {
  type: 'lineItems';
  heading?: string;
  columns: readonly {
    key: string;
    label: string;
    align?: 'left' | 'right';

    /** The column's width relative to the others. */
    share?: number;

    /** Extra space between this column and the next. */
    gutter?: boolean;
  }[];
  rows: readonly Readonly<Record<string, string>>[];
}

export interface TotalsBlock {
  type: 'totals';
  rows: readonly { label: string; value: string; emphasis?: boolean }[];
}

export interface NoticeBlock {
  type: 'notice';
  tone: 'info' | 'warning';
  text: string;
}

interface ProseBlock {
  type: 'prose';
  heading?: string;
  text: string;
}

export interface LetterheadBlock {
  type: 'letterhead';

  nameLines: readonly string[];

  detailLines: readonly string[];
}

export type DocumentBlock =
  | LetterheadBlock
  | HeadingBlock
  | KeyValuesBlock
  | LineItemsBlock
  | TotalsBlock
  | NoticeBlock
  | ProseBlock;

export interface DocumentModel {
  title: string;
  blocks: readonly DocumentBlock[];
  footer?: string;
}
