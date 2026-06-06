import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMdx, roundTripSemanticEqual, serializeMdx, validateMdx } from "./index";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

describe("MDX pipeline golden fixtures", () => {
  for (const file of readdirSync(fixturesDir).filter((name: string) => name.endsWith(".mdx"))) {
    it(`${file}: parse -> normalize -> serialize -> parse -> semantic equality`, () => {
      const source = readFileSync(join(fixturesDir, file), "utf8");
      expect(roundTripSemanticEqual(source)).toBe(true);
    });
  }
});

describe("MDX classification", () => {
  it("classifies known components as structured", () => {
    const parsed = parseMdx("<Callout type=\"info\" />\n");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.tree.children[0]).toMatchObject({ type: "mdx_component", name: "Callout", registryStatus: "known", mdxKind: "structured_component" });
  });

  it("classifies unknown components as opaque source-backed cards", () => {
    const parsed = parseMdx("<CustomThing answer={42} />\n");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.tree.children[0]).toMatchObject({ type: "mdx_component", name: "CustomThing", registryStatus: "unknown", mdxKind: "opaque_component", originalSource: "<CustomThing answer={42} />" });
  });

  it("returns diagnostics for unclosed components", () => {
    const diagnostics = validateMdx("<Callout>\n");
    expect(diagnostics[0]?.message).toContain("Unclosed component");
  });

  it("serializes parseable content", () => {
    const parsed = parseMdx("# Hello\n");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeMdx(parsed.tree)).toBe("# Hello\n");
  });
});
