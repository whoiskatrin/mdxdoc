# API / CLI / UI Parity Audit

This document tracks the Phase 3 contract: every meaningful UI action should map to a public API operation and, where practical, a CLI command.

Status legend:

- ✅ implemented and tested
- 🟡 partial/scaffolded or metadata-only
- ⏭️ intentionally deferred to later phase

## Current MVP parity

| Product action | UI | Public API | SDK | CLI | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- |
| List workspaces | Dashboard boot | `GET /api/v1/workspaces` | `client.workspaces.list()` | `mdxdoc workspaces` | API/CLI live smoke | ✅ |
| Create workspace | Auto-created when needed | `POST /api/v1/workspaces` | `client.workspaces.create()` | via API only | API tests | ✅ |
| List documents | Dashboard | `GET /api/v1/workspaces/:workspaceId/documents` | `client.docs.list(workspaceId)` | `mdxdoc docs list` or `mdxdoc docs list --workspace <id>` | E2E/API/CLI live smoke | ✅ |
| Create document | New document button / command palette | `POST /api/v1/workspaces/:workspaceId/documents` | `client.docs.create()` | `mdxdoc docs create "Title"` or `mdxdoc docs create "Title" --workspace <id>` | E2E/API/CLI live smoke | ✅ |
| Import document source | New doc source body | same create endpoint with `source` | `client.docs.create(...source)` | `mdxdoc import file.mdx --workspace <id>` | CLI live smoke covers create; import command smoke pending | ✅ |
| Open document | Dashboard card / shared `?doc=` URL | `GET /api/v1/documents/:id` + `GET /session` | `client.docs.get()`, `client.docs.session()` | `mdxdoc docs get <doc>` | E2E | ✅ |
| Rename document | Rename dialog | `PATCH /api/v1/documents/:id` | `client.docs.update()` | `mdxdoc docs rename <doc> "Title"` | E2E/API | ✅ |
| Delete one document | Card menu remove | `DELETE /api/v1/documents/:id` | `client.docs.delete()` | `mdxdoc docs delete <doc>` | E2E/API/CLI live smoke | ✅ |
| Bulk delete documents | Select docs + remove selected | repeated `DELETE /documents/:id` | repeated `client.docs.delete()` | shell loop over `mdxdoc docs delete` | E2E | ✅ |
| Share document link | Share button copies `?doc=` URL | `GET /documents/:id/session` | `client.docs.session()` | no direct CLI equivalent needed | E2E | ✅ |
| Live collaboration session | Markdown editor | WebSocket via `/collab/document-room/:room`; session via API | session helper | no CLI equivalent | E2E two-tab typing | ✅ |
| Pull source | Markdown editor load | `GET /api/v1/documents/:id/source` | `client.docs.source()` | `mdxdoc pull <doc> --out file.mdx` | E2E/API/CLI live smoke | ✅ |
| Apply source directly | Apply changes | `PUT /api/v1/documents/:id/source` | `client.docs.putSource()` | `mdxdoc push <doc> file.mdx --apply` | E2E/API | ✅ |
| Safe source push as changeset | Suggesting mode / propose suggestion | `POST /api/v1/documents/:id/changesets` + `POST /api/v1/documents/:id/suggestions` | `client.docs.createChangeset()` + `client.docs.createSuggestion()` | `mdxdoc push <doc> file.mdx` | E2E/API/CLI live smoke | ✅ |
| Preview source | Preview tab | `POST /api/v1/documents/:id/preview` | `client.docs.preview()` | `mdxdoc preview <doc> --out preview.html` | E2E/API surface; CLI help smoke | ✅ |
| Export source | not yet explicit UI button | `GET /api/v1/documents/:id/export` | `client.docs.export()` | `mdxdoc export <doc> --format mdx --out file.mdx` | API/CLI help smoke | ✅ |
| Create general comment | Comments tab | `POST /api/v1/documents/:id/comments` | `client.docs.createComment()` | `mdxdoc comment add <doc> --message ...` | E2E/API/CLI live smoke | ✅ |
| Create selected-text comment | Select text + comment | `POST /comments` with `source_range` anchor | `client.docs.createComment()` | `mdxdoc comment add <doc> --quote ... --message ...` | E2E/API | ✅ |
| List comments | Comments tab | `GET /api/v1/documents/:id/comments` | `client.docs.comments()` | `mdxdoc comments <doc>` | E2E/API | ✅ |
| Resolve comment | Resolve button | `POST /api/v1/comments/:id/resolve` | `client.docs.resolveComment()` | `mdxdoc comment resolve <id>` | E2E/API/CLI live smoke | ✅ |
| Reopen comment | API only | `POST /api/v1/comments/:id/reopen` | missing SDK helper | missing CLI command | API route exists | 🟡 |
| List suggestions | Suggestions tab | `GET /api/v1/documents/:id/suggestions` | `client.docs.suggestions()` | `mdxdoc suggestions <doc>` | E2E/API | ✅ |
| Accept suggestion | Accept button | `POST /api/v1/suggestions/:id/accept` | `client.docs.acceptSuggestion()` | `mdxdoc suggestion accept <id>` | E2E/API | ✅ |
| Reject suggestion | Reject button | `POST /api/v1/suggestions/:id/reject` | `client.docs.rejectSuggestion()` | `mdxdoc suggestion reject <id>` | API/CLI help smoke | ✅ |
| List changesets | Changesets tab | `GET /api/v1/documents/:id/changesets` | `client.docs.changesets()` | `mdxdoc changesets <doc>` | E2E/API | ✅ |
| Create changeset | Create changeset button | `POST /api/v1/documents/:id/changesets` | `client.docs.createChangeset()` | `mdxdoc changeset create <doc>` | E2E/API/CLI live smoke | ✅ |
| Accept changeset | Accept button | `POST /api/v1/changesets/:id/accept` | `client.docs.acceptChangeset()` | `mdxdoc changeset accept <id>` | API | ✅ applies pending source suggestions, reports conflicts |
| Reject changeset | Reject button | `POST /api/v1/changesets/:id/reject` | `client.docs.rejectChangeset()` | `mdxdoc changeset reject <id>` | API/CLI live smoke | ✅ rejects pending suggestions |
| List versions | Versions tab | `GET /api/v1/documents/:id/versions` | `client.docs.versions()` | `mdxdoc versions <doc>` | E2E/API/CLI live smoke | ✅ |
| Create checkpoint | Create checkpoint button | `POST /api/v1/documents/:id/versions` | `client.docs.checkpoint()` | `mdxdoc checkpoint <doc>` | E2E/API/CLI live smoke | ✅ |
| Restore version | Restore button | `POST /api/v1/documents/:id/restore/:versionId` | `client.docs.restore()` | `mdxdoc restore <doc> <version>` | API | ✅ |
| Command palette | Cmd/Ctrl+K | maps to existing APIs | maps to existing SDK calls | no CLI equivalent needed | E2E | ✅ |

## Known parity gaps

1. `comment reopen` exists in API but does not yet have SDK/CLI/UI helpers.
2. Changeset accept applies pending source suggestions, but rich grouped diff/reorder controls are still future work.
3. CLI login/token persistence is prototype-grade; production auth is still future work.
4. Version restore has UI/API/CLI, but E2E currently verifies visibility/checkpoint rather than full restore UI flow.
5. OpenAPI tests currently validate route/schema presence, not full response body schemas.

## Live CLI smoke

Run live smoke against deployed API:

```bash
MDXDOC_CLI_SMOKE_API_URL=https://mdxdoc-api.agents-b8a.workers.dev \
  pnpm vitest run apps/cli/test/cli-live.test.ts
```

Latest manual result:

```txt
1 test file passed
1 test passed
```
