import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { PROSEMIRROR_FRAGMENT_NAME, SOURCE_TEXT_NAME, sourceFromSnapshot, sourceFromYdoc, ydocFromSource } from "../src/services/yjs-source-codec";

describe("source ⇄ Yjs codec", () => {
  it("stores both canonical markdown text and prosemirror fragment", () => {
    const doc = ydocFromSource("# Hello\n\nWorld\n");
    expect(doc.getText(SOURCE_TEXT_NAME).toString()).toBe("# Hello\n\nWorld\n");
    expect(doc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME).length).toBeGreaterThan(0);
    expect(sourceFromYdoc(doc)).toBe("# Hello\n\nWorld\n");
  });

  it("recovers source from compact Yjs snapshot", () => {
    const doc = ydocFromSource("<Unknown value={1} />\n");
    const snapshot = Y.encodeStateAsUpdate(doc);
    expect(sourceFromSnapshot(snapshot)).toBe("<Unknown value={1} />\n");
  });
});
