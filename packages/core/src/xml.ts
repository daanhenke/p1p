// Generic XML read/write harness (cross-game → lives in core). Thin wrapper over fast-xml-parser so
// every datatype serialises its model the same way. Attributes use the "@" prefix; text is "#text".
// (Runtime XSD validation against each datatype's `xsd` is a CLI concern wired via xmllint-wasm later;
// the XSD strings are the published contract + power editor autocomplete.)

import { XMLBuilder, XMLParser } from "fast-xml-parser";

const ATTR = "@";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  textNodeName: "#text",
  parseAttributeValue: false,
  trimValues: true,
});

// Escape only what XML requires: in text content just & < > (apostrophes/quotes read naturally);
// in a double-quoted attribute value & < " (a literal ' is fine). fast-xml-parser otherwise turns
// every ' into &apos; and " into &quot;, which makes dialogue unreadable.
const escapeText = (v: unknown): string =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (v: unknown): string =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  textNodeName: "#text",
  format: true,
  indentBy: "  ",
  suppressEmptyNode: false,
  processEntities: false,
  tagValueProcessor: (_name, val) => escapeText(val),
  attributeValueProcessor: (_name, val) => escapeAttr(val),
});

/** Parse an XML document into a plain object tree (attributes prefixed with "@"). */
export function parseXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

/** Serialise an object tree back to XML, with an XML declaration. */
export function buildXml(tree: Record<string, unknown>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(tree).trimEnd()}\n`;
}

export const xmlAttr = ATTR;
