CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','commenter','viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('md','mdx')),
  status TEXT NOT NULL CHECK (status IN ('active','archived','deleted')),
  current_version INTEGER NOT NULL DEFAULT 0,
  latest_snapshot_key TEXT,
  latest_tree_key TEXT,
  latest_source_key TEXT,
  artifact_repo TEXT,
  artifact_remote TEXT,
  artifact_commit TEXT,
  artifact_manifest_path TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_documents_workspace ON documents(workspace_id, updated_at);

CREATE TABLE document_permissions (
  document_id TEXT NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user','workspace','public_link')),
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','commenter','viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, principal_type, principal_id)
);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  snapshot_key TEXT NOT NULL,
  tree_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  artifact_repo TEXT,
  artifact_commit TEXT,
  artifact_manifest_path TEXT,
  created_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_versions_doc_number ON document_versions(document_id, version_number);

CREATE TABLE comment_threads (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  anchor_status TEXT NOT NULL CHECK (anchor_status IN ('attached','reattached','orphaned','resolved','deleted')),
  status TEXT NOT NULL CHECK (status IN ('open','resolved','deleted')),
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_comments_document_status ON comment_threads(document_id, status, updated_at);

CREATE TABLE comment_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE changesets (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','partially_accepted','accepted','rejected','conflicted')),
  base_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  changeset_id TEXT,
  author_id TEXT NOT NULL,
  type TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','conflicted','stale')),
  conflict_reason TEXT,
  base_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_suggestions_doc_status ON suggestions(document_id, status, updated_at);

CREATE TABLE component_registries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  registry_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  document_id TEXT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE job_ledger (
  idempotency_key TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed','failed')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
