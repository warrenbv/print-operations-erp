// Test helper: reads positioned text runs back out of a rendered PDF so layout tests can assert where
// text landed. It handles what the renderer emits: deflated page streams and hex-encoded WinAnsi text.
import { inflateSync } from 'node:zlib';

const WIN_ANSI_80_9F = '€�‚ƒ„…†‡' + 'ˆ‰Š‹Œ�Ž�' + '�‘’“”•–—' + '˜™š›œ�žŸ';

function winAnsi(hex: string): string {
  return [...Buffer.from(hex, 'hex')]
    .map((byte) =>
      byte >= 0x80 && byte < 0xa0 ? WIN_ANSI_80_9F.charAt(byte - 0x80) : String.fromCharCode(byte),
    )
    .join('');
}

export interface TextRun {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export function textRuns(bytes: Uint8Array): TextRun[] {
  const runs: TextRun[] = [];
  const round = (n: number) => Math.round(n * 10) / 10;
  pageStreams(bytes).forEach((stream, page) => {
    let ctm = [1, 0, 0, 1, 0, 0];
    let tm = [1, 0, 0, 1, 0, 0];
    const saved: number[][] = [];
    const operands: number[] = [];
    let shown = '';
    for (const token of stream.split(/\s+/)) {
      for (const [, hex = ''] of token.matchAll(/<([0-9a-fA-F]*)>/g)) {
        shown += hex;
      }
      if (token === 'q') {
        saved.push(ctm);
      } else if (token === 'Q') {
        ctm = saved.pop() ?? [1, 0, 0, 1, 0, 0];
      } else if (token === 'cm') {
        const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = operands.slice(-6);
        const [A = 1, B = 0, C = 0, D = 1, E = 0, F = 0] = ctm;
        ctm = [
          a * A + b * C,
          a * B + b * D,
          c * A + d * C,
          c * B + d * D,
          e * A + f * C + E,
          e * B + f * D + F,
        ];
      } else if (token === 'Tm') {
        tm = operands.slice(-6);
      } else if (token === 'TJ' || token === 'Tj') {
        const [A = 1, B = 0, C = 0, D = 1, E = 0, F = 0] = ctm;
        const [, , , , x = 0, y = 0] = tm;
        runs.push({
          page,
          x: round(x * A + y * C + E),
          y: round(x * B + y * D + F),
          text: winAnsi(shown),
        });
        shown = '';
      }
      if (/^-?\d+(\.\d+)?$/.test(token)) {
        operands.push(Number(token));
      } else if (!token.startsWith('[') && !token.startsWith('<') && !token.endsWith(']')) {
        operands.length = 0;
      }
    }
  });
  return runs;
}

function pageStreams(bytes: Uint8Array): string[] {
  const pdf = Buffer.from(bytes).toString('latin1');
  const ids = [...pdf.matchAll(/\/Contents\s+(\d+)\s+0\s+R/g)].map((match) => match[1] as string);
  return ids.map((id) => {
    const start = pdf.indexOf(`\n${id} 0 obj`);
    const streamAt = pdf.indexOf('stream', start) + 'stream'.length;
    const dataAt = pdf[streamAt] === '\r' ? streamAt + 2 : streamAt + 1;
    const raw = Buffer.from(bytes).subarray(dataAt, pdf.indexOf('endstream', dataAt));
    return inflateSync(raw).toString('latin1');
  });
}
