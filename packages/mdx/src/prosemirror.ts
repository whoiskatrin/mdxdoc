import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { type Schema, type Node as ProseMirrorNode } from "prosemirror-model";
import type { DocNode, RootNode } from "@mdxdoc/document-model";
import { parseMdx, serializeMdx } from "./index";

export type ProseMirrorJson = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  content?: ProseMirrorJson[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export const mdxdocProseMirrorSchema: Schema = getSchema([StarterKit.configure({ undoRedo: false })]);

export function sourceToProseMirrorJson(source: string): ProseMirrorJson {
  const parsed = parseMdx(source);
  if (!parsed.ok) {
    return { type: "doc", content: [{ type: "codeBlock", attrs: { language: "mdx invalid" }, content: [{ type: "text", text: source }] }] };
  }
  return treeToProseMirrorJson(parsed.tree);
}

export function treeToProseMirrorJson(tree: RootNode): ProseMirrorJson {
  const content = tree.children.flatMap(nodeToProseMirrorJson).filter(Boolean) as ProseMirrorJson[];
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function proseMirrorJsonToSource(json: ProseMirrorJson): string {
  const blocks = (json.content ?? []).map(proseMirrorNodeToSource).filter((block) => block.length > 0);
  return blocks.join("\n\n").trimEnd() + "\n";
}

export function parseProseMirrorJson(json: ProseMirrorJson): ProseMirrorNode {
  return mdxdocProseMirrorSchema.nodeFromJSON(json);
}

export function sourceToProseMirrorNode(source: string): ProseMirrorNode {
  return parseProseMirrorJson(sourceToProseMirrorJson(source));
}

export function assertProseMirrorSourceRoundTrip(source: string): boolean {
  const pm = sourceToProseMirrorJson(source);
  const sourceAgain = proseMirrorJsonToSource(pm);
  const parsedOriginal = parseMdx(source);
  const parsedAgain = parseMdx(sourceAgain);
  if (!parsedOriginal.ok || !parsedAgain.ok) return false;
  return serializeMdx(parsedOriginal.tree) === serializeMdx(parsedAgain.tree);
}

function nodeToProseMirrorJson(node: DocNode): ProseMirrorJson[] {
  switch (node.type) {
    case "frontmatter":
      return sourceBackedBlock(`---\n${node.value}\n---`, "frontmatter");
    case "import_export":
      return sourceBackedBlock(node.value, "mdx-esm");
    case "heading":
      return [{ type: "heading", attrs: { level: node.depth }, content: textContent(textOf(node)) }];
    case "paragraph":
      return [{ type: "paragraph", content: textContent(textOf(node)) }];
    case "code_block":
      return [{ type: "codeBlock", attrs: { language: node.lang ?? null }, content: textContent(node.value) }];
    case "mdx_component":
      if (node.registryStatus === "unknown" || node.mdxKind === "opaque_component") return sourceBackedBlock(node.originalSource ?? `<${node.name} />`, "mdx-component");
      return sourceBackedBlock(node.originalSource ?? `<${node.name}${propsToSource(node.props)} />`, `mdx-component:${node.name}`);
    case "mdx_expression":
      return sourceBackedBlock(node.originalSource, "mdx-expression");
    case "unsupported":
      return sourceBackedBlock(node.originalSource, `unsupported:${node.reason}`);
    default:
      return [{ type: "paragraph", content: textContent(textOf(node)) }];
  }
}

function proseMirrorNodeToSource(node: ProseMirrorJson): string {
  switch (node.type) {
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 1))} ${plainText(node)}`;
    case "paragraph":
      return plainText(node);
    case "code_block":
    case "codeBlock": {
      const text = plainText(node);
      const sourceMatch = text.match(/^<!--mdxdoc-source:[^>]+-->\n([\s\S]*)$/);
      if (sourceMatch) return sourceMatch[1]!;
      const params = typeof node.attrs?.params === "string" ? node.attrs.params : typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return `\`\`\`${params}\n${text}\n\`\`\``;
    }
    case "bullet_list":
    case "bulletList":
      return (node.content ?? []).map((item) => `- ${plainText(item)}`).join("\n");
    case "ordered_list":
    case "orderedList":
      return (node.content ?? []).map((item, index) => `${index + 1}. ${plainText(item)}`).join("\n");
    default:
      return plainText(node);
  }
}

function sourceBackedBlock(source: string, kind: string): ProseMirrorJson[] {
  return [{ type: "codeBlock", attrs: { language: `mdxdoc-source:${kind}` }, content: textContent(`<!--mdxdoc-source:${kind}-->\n${source}`) }];
}

function textContent(value: string): ProseMirrorJson[] {
  return value ? [{ type: "text", text: value }] : [];
}

function plainText(node: ProseMirrorJson): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(plainText).join("");
}

function textOf(node: { children?: DocNode[]; value?: string }): string {
  if (typeof node.value === "string") return node.value;
  return node.children?.map((child) => child.type === "text" ? child.value : child.type === "mdx_expression" ? child.originalSource : "").join("") ?? "";
}

function propsToSource(props: Record<string, unknown>): string {
  const entries = Object.entries(props);
  return entries.length ? ` ${entries.map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join(" ")}` : "";
}
