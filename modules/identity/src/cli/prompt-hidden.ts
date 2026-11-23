// Reads one line from the terminal in raw mode, so a typed password is never echoed. Enter or Ctrl-D
// ends it, Ctrl-C cancels, and other control characters are dropped.
const ENTER = ['\n', '\r'];
const END_OF_TRANSMISSION = String.fromCharCode(4);
const INTERRUPT = String.fromCharCode(3);
const BACKSPACE = [String.fromCharCode(127), String.fromCharCode(8)];

export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;

    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    let value = '';

    const cleanup = (): void => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);

      output.write('\n');
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (ENTER.includes(char) || char === END_OF_TRANSMISSION) {
          cleanup();
          resolve(value);
          return;
        }
        if (char === INTERRUPT) {
          cleanup();
          reject(new Error('Cancelled — nothing was written.'));
          return;
        }
        if (BACKSPACE.includes(char)) {
          value = value.slice(0, -1);
          continue;
        }

        if (char >= ' ') {
          value += char;
        }
      }
    };

    input.on('data', onData);
  });
}
