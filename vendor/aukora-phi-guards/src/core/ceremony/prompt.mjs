// aukora · core/ceremony/prompt.mjs — reading a secret without leaving it lying around
//
// `aukora bind --accept --phrase "<your phrase>"` put the one secret that is NOT on the machine into
// three places at once: the shell's history file, the process table where any other user on the box
// can read it with `ps`, and whatever terminal scrollback the owner later screenshots. For a value
// that cannot be rotated — there is no un-vow — that is the worst available handling.
//
// `aukora-seed`'s `readPhraseHidden` already did this properly. Same idea here: echo off, and the
// bytes never touch `process.argv`.

import { createInterface } from 'node:readline';

const ETX = String.fromCharCode(3); // Ctrl-C
const EOT = String.fromCharCode(4); // Ctrl-D

/**
 * Read one line from the terminal without echoing it.
 *
 * Falls back to a plain read when stdin is not a TTY: a pipe has no echo to suppress, and refusing
 * there would break every scripted use for no gain. This promises only not to DISPLAY what it reads —
 * whether a non-terminal caller is acceptable is the caller's judgement, not this function's.
 */
export function readSecret(promptText) {
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stdout;

    if (!input.isTTY) {
      const plain = createInterface({ input, output });
      plain.question(promptText, (answer) => { plain.close(); resolve(answer); });
      return;
    }

    const rl = createInterface({ input, output, terminal: true });

    // The prompt is written once, by hand, so the muted writer below cannot echo it back per keypress.
    output.write(promptText);

    // ECHO IS RESTORED ON EVERY EXIT PATH, including Ctrl-C and Ctrl-D. Leaving somebody's shell with
    // echo off because their secret prompt was interrupted is a nasty thing to do to a terminal, and
    // it is the sort of detail that only shows up when a real person actually panics mid-ceremony.
    const restore = () => {
      input.removeListener('data', onData);
      output.write('\n');
    };
    const onData = (chunk) => {
      const s = String(chunk);
      if (s.includes('\n') || s.includes('\r') || s.includes(ETX) || s.includes(EOT)) restore();
    };
    input.on('data', onData);

    // eslint-disable-next-line no-underscore-dangle
    rl._writeToOutput = () => {};
    rl.question('', (answer) => {
      restore();
      rl.close();
      resolve(answer);
    });
  });
}
