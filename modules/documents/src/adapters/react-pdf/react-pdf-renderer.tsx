// The `DocumentRenderer` that draws a `DocumentModel` as a US Letter PDF with @react-pdf/renderer, in
// process and without a browser. Layout lives here and content in modules/documents/src/templates.
// Two renders of one model differ in bytes, so a stored checksum identifies a file, not its content:
// modules/documents/test/renderer-determinism.test.ts.
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import type { DocumentBlock, DocumentModel, LetterheadBlock } from '../../document-model';
import type { DocumentRenderer } from '../../ports';

const palette = {
  ink: '#111111',
  muted: '#555555',
  rule: '#cccccc',
  warning: '#8a5a00',
  warningBg: '#fdf3e0',
};

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: palette.ink, fontFamily: 'Helvetica' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 11, color: palette.muted, marginTop: 2 },
  block: { marginTop: 16 },
  blockHeading: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  kvRow: { flexDirection: 'row', marginBottom: 2 },
  kvLabel: { width: 110, color: palette.muted },
  kvValue: { flex: 1 },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: palette.ink,
    paddingBottom: 4,
    marginBottom: 4,
    fontFamily: 'Helvetica-Bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: palette.rule,
  },
  cell: { flex: 1, paddingRight: 6 },
  cellRight: { flex: 1, paddingRight: 6, textAlign: 'right' },

  cellGutter: { paddingRight: 18 },
  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  totalsLabel: { color: palette.muted, marginRight: 12 },
  totalsValue: { width: 90, textAlign: 'right' },
  emphasis: { fontFamily: 'Helvetica-Bold' },
  notice: { padding: 8, borderLeftWidth: 3, borderLeftColor: palette.warning },
  noticeWarning: { backgroundColor: palette.warningBg, color: palette.warning },
  prose: { lineHeight: 1.4 },
  letterhead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  letterheadName: { fontSize: 16, fontFamily: 'Helvetica-Bold', lineHeight: 1.1 },
  letterheadDetail: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 1 },

  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: palette.muted,
    borderTopWidth: 1,
    borderTopColor: palette.rule,
    paddingTop: 6,
  },
});

export const LONGEST_UNBROKEN_WORD = 25;

function wholeWordsUpTo(longest: number): (word: string) => string[] {
  return (word) => (word.length <= longest ? [word] : [...word]);
}

// Words up to `LONGEST_UNBROKEN_WORD` characters stay whole, so a cell wraps only between words. A
// longer token may break at any character, so it cannot overflow its column:
// modules/documents/test/table-rows.test.ts.
Font.registerHyphenationCallback(wholeWordsUpTo(LONGEST_UNBROKEN_WORD));
type LineItemsColumn = Extract<DocumentBlock, { type: 'lineItems' }>['columns'][number];

function cellStyle(column: LineItemsColumn) {
  const base = column.align === 'right' ? styles.cellRight : styles.cell;
  if (column.share === undefined && column.gutter !== true) {
    return base;
  }
  return [
    base,
    ...(column.share === undefined ? [] : [{ flex: column.share }]),
    ...(column.gutter === true ? [styles.cellGutter] : []),
  ];
}
function renderLetterhead(block: LetterheadBlock, key: number): ReactElement {
  return (
    <View key={key} style={styles.letterhead}>
      <View>
        {block.nameLines.map((line, index) => (
          <Text key={`n${String(index)}`} style={styles.letterheadName}>
            {line}
          </Text>
        ))}
        {block.detailLines.map((line, index) => (
          <Text key={`d${String(index)}`} style={styles.letterheadDetail}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

function renderBlock(block: DocumentBlock, key: number): ReactElement {
  switch (block.type) {
    case 'letterhead':
      return renderLetterhead(block, key);

    case 'heading':
      return (
        <View key={key}>
          <Text style={styles.title}>{block.title}</Text>
          {block.subtitle ? <Text style={styles.subtitle}>{block.subtitle}</Text> : null}
        </View>
      );

    case 'keyValues':
      return (
        <View key={key} style={styles.block}>
          {block.heading ? <Text style={styles.blockHeading}>{block.heading}</Text> : null}
          {block.rows.map((row, index) => (
            <View key={index} style={styles.kvRow}>
              <Text style={styles.kvLabel}>{row.label}</Text>
              <Text style={styles.kvValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      );

    case 'lineItems':
      return (
        <View key={key} style={styles.block}>
          {block.heading ? <Text style={styles.blockHeading}>{block.heading}</Text> : null}
          <View style={styles.tableHeader}>
            {block.columns.map((column) => (
              <Text key={column.key} style={cellStyle(column)}>
                {column.label}
              </Text>
            ))}
          </View>
          {block.rows.map((row, index) => (
            <View key={index} style={styles.tableRow} wrap={false}>
              {block.columns.map((column) => (
                <Text key={column.key} style={cellStyle(column)}>
                  {row[column.key] ?? ''}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );

    case 'totals':
      return (
        <View key={key} style={styles.block}>
          {block.rows.map((row, index) => (
            <View key={index} style={styles.totalsRow}>
              <Text style={[styles.totalsLabel, ...(row.emphasis ? [styles.emphasis] : [])]}>
                {row.label}
              </Text>
              <Text style={[styles.totalsValue, ...(row.emphasis ? [styles.emphasis] : [])]}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'notice':
      return (
        <View
          key={key}
          style={[
            styles.block,
            styles.notice,
            ...(block.tone === 'warning' ? [styles.noticeWarning] : []),
          ]}
        >
          <Text>{block.text}</Text>
        </View>
      );

    case 'prose':
      return (
        <View key={key} style={styles.block}>
          {block.heading ? <Text style={styles.blockHeading}>{block.heading}</Text> : null}
          <Text style={styles.prose}>{block.text}</Text>
        </View>
      );
  }
}

export class ReactPdfDocumentRenderer implements DocumentRenderer {
  async render(model: DocumentModel): Promise<Uint8Array> {
    const element = (
      <Document title={model.title}>
        <Page size="LETTER" style={styles.page}>
          {model.blocks.map((block, index) => renderBlock(block, index))}
          {model.footer ? (
            <Text style={styles.footer} fixed>
              {model.footer}
            </Text>
          ) : null}
        </Page>
      </Document>
    );
    return renderToBuffer(element);
  }
}
