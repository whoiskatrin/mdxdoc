export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type UserId = Brand<string, "UserId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type DocumentId = Brand<string, "DocumentId">;
export type VersionId = Brand<string, "VersionId">;
export type NodeId = Brand<string, "NodeId">;
export type SuggestionId = Brand<string, "SuggestionId">;
export type ChangeSetId = Brand<string, "ChangeSetId">;

export type DocumentFormat = "md" | "mdx";

export type DocumentRecord = {
  id: DocumentId;
  workspaceId: WorkspaceId;
  title: string;
  format: DocumentFormat;
  status: "active" | "archived" | "deleted";
  currentVersion: number;
  latestSnapshotKey: string | null;
  latestTreeKey: string | null;
  latestSourceKey: string | null;
  artifactRepo: string | null;
  artifactRemote: string | null;
  artifactCommit: string | null;
  artifactManifestPath: string | null;
  createdBy: UserId;
  createdAt: string;
  updatedAt: string;
};

export type BaseNode = {
  id: NodeId;
  type: string;
  attrs?: Record<string, unknown>;
  children?: DocNode[];
  sourceRange?: { start: number; end: number };
  sourceHash?: string;
};

export type RootNode = BaseNode & { type: "root"; children: DocNode[] };
export type FrontmatterNode = BaseNode & { type: "frontmatter"; value: string };
export type ImportExportNode = BaseNode & { type: "import_export"; value: string };
export type ParagraphNode = BaseNode & { type: "paragraph"; children: DocNode[] };
export type HeadingNode = BaseNode & { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: DocNode[] };
export type TextNode = BaseNode & { type: "text"; value: string };
export type LinkNode = BaseNode & { type: "link"; url: string; title?: string; children: DocNode[] };
export type ListNode = BaseNode & { type: "list"; ordered: boolean; children: DocNode[] };
export type CodeBlockNode = BaseNode & { type: "code_block"; lang?: string; value: string };
export type TableNode = BaseNode & { type: "table"; rows: string[][] };
export type ImageNode = BaseNode & { type: "image"; url: string; alt?: string };
export type MdxComponentNode = BaseNode & {
  type: "mdx_component";
  name: string;
  kind: "block" | "inline";
  mdxKind: "structured_component" | "opaque_component";
  props: Record<string, unknown>;
  children?: DocNode[];
  registryStatus: "known" | "unknown";
  originalSource?: string;
};
export type MdxExpressionNode = BaseNode & { type: "mdx_expression"; value: string; originalSource: string };
export type UnsupportedNode = BaseNode & { type: "unsupported"; reason: string; originalSource: string };

export type DocNode =
  | RootNode
  | FrontmatterNode
  | ImportExportNode
  | ParagraphNode
  | HeadingNode
  | TextNode
  | LinkNode
  | ListNode
  | CodeBlockNode
  | TableNode
  | ImageNode
  | MdxComponentNode
  | MdxExpressionNode
  | UnsupportedNode;

export type ComponentDefinition = {
  name: string;
  kind: "block" | "inline";
  propsSchema: Record<string, unknown>;
  children: "none" | "text" | "markdown" | "mdx";
  editorRenderer: "card" | "callout" | "custom";
  previewRenderer: string;
  editableProps: string[];
};

export type ComponentRegistry = {
  id: string;
  workspaceId: string;
  version: number;
  components: ComponentDefinition[];
};

export type DocumentVersion = {
  id: VersionId;
  documentId: DocumentId;
  versionNumber: number;
  snapshotKey: string;
  treeKey: string;
  sourceKey: string;
  createdBy: UserId | "system";
  reason:
    | "created"
    | "auto_checkpoint"
    | "manual_checkpoint"
    | "import"
    | "source_apply"
    | "suggestion_accept"
    | "changeset_accept"
    | "restore";
  createdAt: string;
};

export function nodeId(input: string): NodeId {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `node_${(hash >>> 0).toString(36)}` as NodeId;
}

export function normalizeNode<T extends DocNode>(node: T): T {
  if (node.children) {
    node.children = node.children.filter(Boolean).map((child) => normalizeNode(child));
  }
  return node;
}

function stripVolatile(node: DocNode): unknown {
  const { id: _id, sourceRange: _range, sourceHash: _hash, ...rest } = node;
  if ("children" in rest && Array.isArray(rest.children)) {
    return { ...rest, children: rest.children.map(stripVolatile) };
  }
  return rest;
}

export function semanticEqual(a: DocNode, b: DocNode): boolean {
  return JSON.stringify(stripVolatile(a)) === JSON.stringify(stripVolatile(b));
}

export const defaultRegistry: ComponentRegistry = {
  id: "default",
  workspaceId: "system",
  version: 1,
  components: ["Callout", "Tabs", "Tab", "Steps", "Step", "Card", "CardGrid", "Accordion", "AccordionItem", "CodeGroup"].map((name) => ({
    name,
    kind: "block",
    propsSchema: { type: "object", additionalProperties: true },
    children: ["Tab", "Step", "AccordionItem"].includes(name) ? "markdown" : name === "Card" ? "text" : "mdx",
    editorRenderer: name === "Callout" ? "callout" : "card",
    previewRenderer: name,
    editableProps: []
  }))
};
