import { describe, expect, it } from "vitest";
import { assertProseMirrorSourceRoundTrip, proseMirrorJsonToSource, sourceToProseMirrorJson } from "./prosemirror";

describe("Markdown/MDX ProseMirror bridge", () => {
  it("converts headings and paragraphs", () => {
    const json = sourceToProseMirrorJson("# Hello\n\nWorld\n");
    expect(json).toMatchObject({ type: "doc", content: [{ type: "heading" }, { type: "paragraph" }] });
    expect(proseMirrorJsonToSource(json)).toBe("# Hello\n\nWorld\n");
  });

  it("keeps unknown MDX as source-backed visible blocks", () => {
    const json = sourceToProseMirrorJson("<Unknown value={1} />\n");
    expect(json.content?.[0]).toMatchObject({ type: "codeBlock", attrs: { language: "mdxdoc-source:mdx-component" } });
    expect(proseMirrorJsonToSource(json)).toBe("<Unknown value={1} />\n");
  });

  it("round-trips representative source semantically", () => {
    expect(assertProseMirrorSourceRoundTrip("---\ntitle: Test\n---\n\nimport X from './x'\n\n# Hello\n\n<Callout type=\"info\" />\n\n{value}\n")).toBe(true);
  });
});
