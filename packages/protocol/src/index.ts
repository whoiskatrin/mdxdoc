import type {
  ChangeSetId,
  ComponentRegistry,
  DocumentFormat,
  DocumentId,
  NodeId,
  SuggestionId,
  UserId,
  WorkspaceId
} from "@mdxdoc/document-model";

export type EffectiveRole = "owner" | "admin" | "editor" | "commenter" | "viewer";
export type BehaviorMode = "edit" | "suggest" | "view";
export type SurfaceMode = "wysiwyg" | "source" | "preview";
export type SessionId = string;

export type RelativePositionJson = unknown;
export type Anchor = TextRangeAnchor | BlockAnchor | AttributeAnchor | SourceRangeAnchor;
export type TextRangeAnchor = {
  kind: "text_range";
  nodeId: NodeId;
  from: RelativePositionJson;
  to: RelativePositionJson;
  quote: string;
  prefix: string;
  suffix: string;
  sourceStart?: number;
  sourceEnd?: number;
};
export type BlockAnchor = { kind: "block"; nodeId: NodeId; quote?: string };
export type AttributeAnchor = { kind: "attribute"; nodeId: NodeId; attributeName: string; quote?: string };
export type SourceRangeAnchor = { kind: "source_range"; start: number; end: number; quote: string; prefix?: string; suffix?: string };

export type CommentThread = {
  id: string;
  documentId: DocumentId;
  authorId: UserId;
  anchor: Anchor;
  anchorStatus: "attached" | "reattached" | "orphaned" | "resolved" | "deleted";
  status: "open" | "resolved" | "deleted";
  messages: CommentMessage[];
  createdAt: string;
  updatedAt: string;
};
export type CommentMessage = { id: string; threadId: string; authorId: UserId; body: string; createdAt: string; updatedAt: string; deletedAt?: string };
export type CreateCommentPayload = { anchor: Anchor; body: string };
export type ReplyPayload = { body: string };

export type SuggestionType =
  | "insert_text"
  | "delete_text"
  | "replace_text"
  | "insert_block"
  | "delete_block"
  | "replace_block"
  | "update_mdx_prop"
  | "replace_mdx_node"
  | "replace_source_range"
  | "replace_document_source";
export type DocFragment = unknown;
export type Suggestion = {
  id: SuggestionId;
  documentId: DocumentId;
  authorId: UserId;
  changesetId?: ChangeSetId;
  type: SuggestionType;
  anchor: Anchor;
  before?: DocFragment | string;
  after?: DocFragment | string;
  status: "pending" | "accepted" | "rejected" | "conflicted" | "stale";
  conflictReason?: string;
  baseVersion: number;
  createdAt: string;
  updatedAt: string;
};
export type ChangeSet = {
  id: ChangeSetId;
  documentId: DocumentId;
  authorId: UserId;
  title: string;
  description?: string;
  suggestionIds: SuggestionId[];
  status: "pending" | "partially_accepted" | "accepted" | "rejected" | "conflicted";
  baseVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type PresenceState = {
  sessionId: SessionId;
  userId: UserId;
  name: string;
  avatarUrl?: string;
  cursor?: unknown;
  selection?: unknown;
  mode: BehaviorMode;
  surface: SurfaceMode;
  updatedAt: string;
};

export type ClientWsEvent =
  | { type: "yjs.update"; update: ArrayBuffer; origin: "wysiwyg" | "source_apply" | "suggestion_accept" }
  | { type: "presence.update"; cursor?: unknown; selection?: unknown; mode: BehaviorMode; surface: SurfaceMode }
  | { type: "comment.create"; payload: CreateCommentPayload }
  | { type: "comment.reply"; payload: ReplyPayload }
  | { type: "comment.resolve"; commentId: string }
  | { type: "comment.reopen"; commentId: string }
  | { type: "suggestion.create"; payload: unknown }
  | { type: "suggestion.accept"; suggestionId: string; baseVersion: number }
  | { type: "suggestion.reject"; suggestionId: string }
  | { type: "changeset.accept"; changesetId: string; baseVersion: number }
  | { type: "changeset.reject"; changesetId: string }
  | { type: "ping" };

export type ServerWsEvent =
  | { type: "state.init"; documentId: string; version: number; serverSeq: number; ydocSnapshot: ArrayBuffer; comments: CommentThread[]; suggestions: Suggestion[]; effectiveRole: EffectiveRole }
  | { type: "yjs.broadcast"; update: ArrayBuffer; serverSeq: number; version: number }
  | { type: "op.ack"; clientSeq: number; serverSeq: number; version: number }
  | { type: "presence.broadcast"; users: PresenceState[] }
  | { type: "comment.broadcast"; comment: CommentThread }
  | { type: "suggestion.broadcast"; suggestion: Suggestion }
  | { type: "changeset.broadcast"; changeset: ChangeSet }
  | { type: "conflict"; entityId: string; reason: string }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

export type ApiError = { error: { code: string; message: string; details?: unknown; requestId: string } };
export type HealthResponse = { ok: true; service: "mdxdoc-api"; version: string };
export type CreateWorkspaceRequest = { name: string; slug: string };
export type CreateDocumentRequest = { title: string; format: DocumentFormat; source?: string };
export type SourceResponse = { documentId: DocumentId; version: number; source: string };
export type PutSourceRequest = { baseVersion: number; source: string };
export type ComponentRegistryResponse = { registry: ComponentRegistry };

export function canRole(role: EffectiveRole, action: "view" | "edit" | "suggest" | "comment" | "accept" | "manage"): boolean {
  const rank: Record<EffectiveRole, number> = { viewer: 0, commenter: 1, editor: 2, admin: 3, owner: 4 };
  if (action === "view") return true;
  if (action === "comment" || action === "suggest") return rank[role] >= rank.commenter;
  if (action === "edit" || action === "accept") return rank[role] >= rank.editor;
  return rank[role] >= rank.admin;
}
