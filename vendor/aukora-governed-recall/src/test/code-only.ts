// test/code-only.ts — STRIP THE COMMENTS, AND DO NOT EAT THE CODE.
//
// ══ WHY THIS IS ITS OWN FILE WITH ITS OWN TEST ══
//
// Twenty-six suites read source through this function to decide whether an assertion is looking at
// code. Almost all of those assertions are NEGATIVE — "this forbidden thing does not appear" — so
// anything this function silently deletes is a thing those suites cannot see. A checker that reads
// less just finds less, and reports it as clean.
//
// ══ TWO DEFECTS, BOTH FOUND BY EXPLOIT RATHER THAN BY READING ══
//
// 1. A GLOB INSIDE A STRING OPENED A BLOCK COMMENT. The original was a pair of regexes:
//
//        .replace(/\/\*[\s\S]*?\*\//g, '')
//        .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
//
//    `'core/witness/**'` contains `/*`, so the non-greedy match ran to the next `*/` ANYWHERE later
//    in the file. Measured on `surface/door.ts`: five of eleven route declarations deleted.
//
// 2. `//` INSIDE AN ORDINARY STRING TRUNCATED THE LINE. The first fix put line comments first and
//    kept the `[^:]` guard, which only ever protected `http://`. Measured exploit:
//
//        const url = 'x//y';  localStorage.setItem('aura', '1');
//
//    became `const url = 'x`, and all eight `aura-no-stored-value` tests stayed green over a real
//    forbidden call. Worse than the first defect in one way: it eats silently, one line at a time,
//    and the line it eats is exactly the kind a negative check cares about.
//
// Both were found by someone PLACING A KNOWN MATCH and watching the instrument miss it. Neither was
// findable by reading this file, which is why `test/code-only.test.ts` now carries both exploits and
// why every negative check built on this must carry its own controls — see `test/coverage.ts`.
//
// ══ THE IMPLEMENTATION, AND WHY IT IS A SCANNER AND NOT A REGEX ══
//
// A regex cannot know whether it is inside a string, and that is the whole bug — twice. So this is a
// single left-to-right pass with five states: code, line comment, block comment, and the three string
// kinds. It is still a heuristic and not a parser, and the two places it approximates both fail
// TOWARD READING TOO MUCH, which is the safe direction for a negative check:
//
//   · A TEMPLATE LITERAL is treated as opaque string content, including any `${...}` expression. Code
//     inside an interpolation is therefore kept rather than analysed — so a forbidden call written
//     there is still visible to the caller.
//   · A REGEX LITERAL is not recognised. An unbalanced quote inside one — `/don't/` — starts a string
//     state that then recovers at the newline, because a JavaScript string cannot span a line break.
//     The effect is that the rest of that line is kept verbatim.
//
// An unescaped `//` cannot occur inside a regex literal (an unescaped `/` would end it), so the
// defect that started all this cannot recur through that route.

/** What `codeOnly` is looking at, one character at a time. */
type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';

/**
 * Source with comments removed, keeping every byte of code — including strings that contain `//`,
 * `/*`, or both. Line count is preserved so a match can still be located by line.
 */
export function codeOnly(src: string): string {
  let out = '';
  let mode: Mode = 'code';
  let i = 0;

  while (i < src.length) {
    const c = src[i]!;
    const d = src[i + 1];

    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") { mode = 'single'; }
      else if (c === '"') { mode = 'double'; }
      else if (c === '`') { mode = 'template'; }
      out += c; i += 1; continue;
    }

    if (mode === 'line') {
      // The newline survives; everything before it does not.
      if (c === '\n') { mode = 'code'; out += c; }
      i += 1; continue;
    }

    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; i += 2; continue; }
      if (c === '\n') out += c;          // keep the line structure, drop the prose
      i += 1; continue;
    }

    // ── inside a string: everything is kept verbatim ──
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
    if ((mode === 'single' && c === "'")
      || (mode === 'double' && c === '"')
      || (mode === 'template' && c === '`')) {
      mode = 'code';
    } else if (c === '\n' && mode !== 'template') {
      // Unterminated — a real string cannot cross a line, so this was never one. Recover rather than
      // consuming the rest of the file, which is how the first version of this file failed.
      mode = 'code';
    }
    out += c; i += 1; continue;
  }

  return out;
}
