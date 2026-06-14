// Textbox validator parity vs the Python renderer model (src/persona1/text/textbox.py).
import { describe, expect, it } from "vitest";
import { overflows, pageRows, wordBreaks } from "../src/text/textbox.js";
import fx from "./fixtures/textbox.json";

describe("textbox validator (== py)", () => {
  for (const c of fx) {
    it(`${c.enc} ${JSON.stringify(c.text).slice(0, 32)}…`, () => {
      expect(pageRows(c.text, c.row)).toEqual(c.pageRows);
      expect(overflows(c.text, c.row)).toEqual(c.overflows);
      expect(wordBreaks(c.text, c.row)).toEqual(c.wordBreaks);
    });
  }
});
