import {
  type ComponentRegistry,
  type DocNode,
  type FrontmatterNode,
  type HeadingNode,
  type ImportExportNode,
  type MdxComponentNode,
  type MdxExpressionNode,
  type ParagraphNode,
  type RootNode,
  type TextNode,
  defaultRegistry,
  nodeId,
  normalizeNode,
  semanticEqual
} from "@mdxdoc/document-model";

export type DiagnosticSeverity = "error" | "warning";
export type MdxDiagnostic = {
  line: number;
  column: number;
  severity: DiagnosticSeverity;
  message: string;
  excerpt: string;
};
export type ParseResult = { ok: true; tree: RootNode; diagnostics: [] } | { ok: false; diagnostics: MdxDiagnostic[] };

type Line = { text: string; start: number; end: number; number: number };

export function parseMdx(source: string, registry: ComponentRegistry = defaultRegistry): ParseResult {
  const diagnostics = validateMdx(source);
  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, diagnostics };

  const lines = toLines(source);
  const children: DocNode[] = [];
  let i = 0;

  if (lines[0]?.text.trim() === "---") {
    const start = lines[0].start;
    i = 1;
    const body: string[] = [];
    while (i < lines.length && lines[i]?.text.trim() !== "---") body.push(lines[i++]?.text ?? "");
    if (lines[i]?.text.trim() === "---") {
      const end = lines[i]!.end;
      children.push(makeFrontmatter(body.join("\n"), start, end));
      i++;
    }
  }

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.text.trim()) {
      i++;
      continue;
    }

    if (/^(import|export)\s/.test(line.text.trim())) {
      const block = [line.text];
      const start = line.start;
      i++;
      while (i < lines.length && lines[i]!.text.trim() && !isBlockStart(lines[i]!.text)) block.push(lines[i++]!.text);
      children.push(makeImportExport(block.join("\n"), start, lines[i - 1]!.end));
      continue;
    }

    const codeMatch = line.text.match(/^```(.*)$/);
    if (codeMatch) {
      const start = line.start;
      const lang = codeMatch[1]?.trim() || undefined;
      i++;
      const body: string[] = [];
      while (i < lines.length && !lines[i]!.text.startsWith("```")) body.push(lines[i++]!.text);
      const end = lines[i]?.end ?? lines[i - 1]!.end;
      if (i < lines.length) i++;
      children.push({ id: nodeId(`code:${start}:${body.join("\n")}`), type: "code_block", ...(lang ? { lang } : {}), value: body.join("\n"), sourceRange: { start, end } });
      continue;
    }

    const heading = line.text.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const depth = heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = heading[2] ?? "";
      children.push(makeHeading(depth, text, line.start, line.end));
      i++;
      continue;
    }

    const component = tryParseComponentLine(line.text.trim(), line.start, line.end, registry);
    if (component) {
      children.push(component);
      i++;
      continue;
    }

    const expression = tryParseExpressionLine(line.text.trim(), line.start, line.end);
    if (expression) {
      children.push(expression);
      i++;
      continue;
    }

    const paraStart = line.start;
    const para: string[] = [line.text];
    i++;
    while (i < lines.length && lines[i]!.text.trim() && !isBlockStart(lines[i]!.text)) para.push(lines[i++]!.text);
    const value = para.join("\n");
    children.push(makeParagraph(value, paraStart, lines[i - 1]!.end));
  }

  const root: RootNode = { id: nodeId(`root:${source.length}`), type: "root", children, sourceRange: { start: 0, end: source.length } };
  return { ok: true, tree: normalizeNode(root), diagnostics: [] };
}

export function serializeMdx(tree: RootNode): string {
  return tree.children.map(serializeNode).join("\n\n").trimEnd() + "\n";
}

export function normalizeMdx(tree: RootNode): RootNode {
  return normalizeNode(tree);
}

export function roundTripSemanticEqual(source: string, registry: ComponentRegistry = defaultRegistry): boolean {
  const first = parseMdx(source, registry);
  if (!first.ok) return false;
  const second = parseMdx(serializeMdx(first.tree), registry);
  return second.ok && semanticEqual(normalizeMdx(first.tree), normalizeMdx(second.tree));
}

export function validateMdx(source: string): MdxDiagnostic[] {
  const diagnostics: MdxDiagnostic[] = [];
  const stack: { name: string; line: number }[] = [];
  toLines(source).forEach((line) => {
    const trimmed = line.text.trim();
    const open = trimmed.match(/^<([A-Z][A-Za-z0-9.]*)\b[^>]*>$/);
    const close = trimmed.match(/^<\/([A-Z][A-Za-z0-9.]*)>$/);
    if (open && !trimmed.endsWith("/>")) stack.push({ name: open[1]!, line: line.number });
    if (close) {
      const last = stack.pop();
      if (!last || last.name !== close[1]) {
        diagnostics.push({ line: line.number, column: 1, severity: "error", message: `Unexpected closing component ${close[1]}`, excerpt: line.text });
      }
    }
  });
  for (const item of stack) {
    diagnostics.push({ line: item.line, column: 1, severity: "error", message: `Unclosed component ${item.name}`, excerpt: "" });
  }
  return diagnostics;
}

function serializeNode(node: DocNode): string {
  switch (node.type) {
    case "frontmatter":
      return `---\n${node.value}\n---`;
    case "import_export":
      return node.value;
    case "heading":
      return `${"#".repeat(node.depth)} ${textOf(node)}`;
    case "paragraph":
      return textOf(node);
    case "code_block":
      return `\`\`\`${node.lang ?? ""}\n${node.value}\n\`\`\``;
    case "mdx_component":
      return node.originalSource ?? `<${node.name}${serializeProps(node.props)} />`;
    case "mdx_expression":
      return node.originalSource;
    case "unsupported":
      return node.originalSource;
    default:
      return textOf(node);
  }
}

function textOf(node: { children?: DocNode[]; value?: string }): string {
  if (typeof node.value === "string") return node.value;
  return node.children?.map((child) => (child.type === "text" ? child.value : serializeNode(child))).join("") ?? "";
}

function makeText(value: string, salt: string): TextNode {
  return { id: nodeId(`text:${salt}:${value}`), type: "text", value };
}
function makeParagraph(value: string, start: number, end: number): ParagraphNode {
  return { id: nodeId(`p:${start}:${value}`), type: "paragraph", children: [makeText(value, String(start))], sourceRange: { start, end } };
}
function makeHeading(depth: HeadingNode["depth"], value: string, start: number, end: number): HeadingNode {
  return { id: nodeId(`h:${depth}:${start}:${value}`), type: "heading", depth, children: [makeText(value, String(start))], sourceRange: { start, end } };
}
function makeFrontmatter(value: string, start: number, end: number): FrontmatterNode {
  return { id: nodeId(`fm:${value}`), type: "frontmatter", value, sourceRange: { start, end } };
}
function makeImportExport(value: string, start: number, end: number): ImportExportNode {
  return { id: nodeId(`esm:${value}`), type: "import_export", value, sourceRange: { start, end } };
}

function tryParseComponentLine(source: string, start: number, end: number, registry: ComponentRegistry): MdxComponentNode | null {
  const match = source.match(/^<([A-Z][A-Za-z0-9.]*)\b([^>]*)\/?>(?:<\/\1>)?$/);
  if (!match) return null;
  const name = match[1]!;
  const props = parseProps(match[2] ?? "");
  const known = registry.components.some((component) => component.name === name);
  return {
    id: nodeId(`component:${start}:${source}`),
    type: "mdx_component",
    name,
    kind: "block",
    mdxKind: known ? "structured_component" : "opaque_component",
    props,
    registryStatus: known ? "known" : "unknown",
    ...(known ? {} : { originalSource: source }),
    sourceRange: { start, end }
  };
}

function tryParseExpressionLine(source: string, start: number, end: number): MdxExpressionNode | null {
  if (!/^\{[\s\S]*\}$/.test(source)) return null;
  return { id: nodeId(`expr:${start}:${source}`), type: "mdx_expression", value: source.slice(1, -1), originalSource: source, sourceRange: { start, end } };
}

function parseProps(raw: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const regex = /([A-Za-z_$][\w$-]*)=("[^"]*"|'[^']*'|\{[^}]*\})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) {
    const [, key, value] = match;
    if (!key || !value) continue;
    props[key] = value.startsWith("{") ? value.slice(1, -1).trim() : value.slice(1, -1);
  }
  return props;
}

function serializeProps(props: Record<string, unknown>): string {
  const entries = Object.entries(props);
  if (!entries.length) return "";
  return ` ${entries.map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join(" ")}`;
}

function isBlockStart(text: string): boolean {
  const trimmed = text.trim();
  return /^(#{1,6})\s+/.test(trimmed) || /^```/.test(trimmed) || /^(import|export)\s/.test(trimmed) || /^<([A-Z][A-Za-z0-9.]*)\b/.test(trimmed) || /^\{[\s\S]*\}$/.test(trimmed);
}

function toLines(source: string): Line[] {
  const out: Line[] = [];
  let offset = 0;
  const parts = source.split(/(?<=\n)/);
  parts.forEach((part, index) => {
    const text = part.endsWith("\n") ? part.slice(0, -1) : part;
    out.push({ text, start: offset, end: offset + text.length, number: index + 1 });
    offset += part.length;
  });
  if (source === "") out.push({ text: "", start: 0, end: 0, number: 1 });
  return out;
}

export * from "./prosemirror";
