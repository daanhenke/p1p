// Textbox overflow validation, from the ADV message renderer (Adv_TextRenderStep). The renderer lays
// glyphs with a column counter: each glyph advances it by one, {nl} snaps it up to the next row, and
// the box is shown/cleared at {waitkey}/{ret}/{clearbox}. A page needing more rows than the box holds
// wraps the counter and overwrites itself — the "fails to render" we must avoid with correct newlines.
//
// The box is 4 rows in both builds; only the row WIDTH differs (US glyphs are half-size, so US rows
// hold twice as many cells). Calibrated against the disc: every original US message fits at width 30
// and none at 29 → US = 4×30, JP = 4×15. Ports src/persona1/text/textbox.py. Row width / max-rows are
// parameters so other games (and JP vs US) reuse it; persona1 supplies {us:30, jp:15}, maxRows 4.

export const TEXTBOX_WIDTHS = { us: 30, jp: 15 } as const;
export const TEXTBOX_MAX_ROWS = 4;

const BREAK = new Set(["waitkey", "ret", "clearbox"]);
const TOK = /\{[^}]*\}|〔[^〕]*〕|[\s\S]/gu;

const ceilDiv = (a: number, b: number): number => Math.ceil(a / b);

/** Row count of each textbox page (between breaks), per the renderer's column counter. */
export function pageRows(text: string, row: number): number[] {
  let col = 0;
  const pages: number[] = [];
  for (const m of text.matchAll(TOK)) {
    const s = m[0];
    if (s.startsWith("{")) {
      const mnem = s.slice(1, -1).split(/\s+/)[0];
      if (mnem === "nl") {
        col = Math.floor((col + row) / row) * row;
      } else if (BREAK.has(mnem)) {
        pages.push(ceilDiv(col, row));
        col = 0;
      }
    } else {
      col += 1; // a glyph (incl. 〔xxx〕 unmapped) = one cell
    }
  }
  pages.push(ceilDiv(col, row));
  return pages;
}

/** [page, rows] for pages exceeding maxRows. Empty == fits the box. */
export function overflows(text: string, row: number, maxRows = TEXTBOX_MAX_ROWS): [number, number][] {
  const out: [number, number][] = [];
  pageRows(text, row).forEach((r, i) => {
    if (r > maxRows) out.push([i, r]);
  });
  return out;
}

/**
 * Words split across a row by auto-wrap — a space-delimited run whose characters straddle a row
 * boundary with no space or {nl} to break there. Returns the split words. The renderer char-wraps and
 * eats nothing, so put a space or {nl} at the wrap point.
 */
export function wordBreaks(text: string, row: number): string[] {
  let col = 0;
  let start = 0;
  let word = "";
  const out: string[] = [];
  const check = (): void => {
    if (word && Math.floor(start / row) !== Math.floor((col - 1) / row)) out.push(word);
  };
  for (const m of text.matchAll(TOK)) {
    const s = m[0];
    if (s.startsWith("{")) {
      const mnem = s.slice(1, -1).split(/\s+/)[0];
      if (mnem === "nl") {
        check();
        word = "";
        col = Math.floor((col + row) / row) * row;
      } else if (BREAK.has(mnem)) {
        check();
        word = "";
        col = 0;
      }
      continue; // non-advancing control: keep the word
    }
    if (s === " ") {
      check();
      word = "";
    } else if (!word) {
      start = col;
      word = s;
    } else {
      word += s;
    }
    col += 1;
  }
  check();
  return out;
}
