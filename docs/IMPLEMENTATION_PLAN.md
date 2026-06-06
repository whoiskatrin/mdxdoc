# mdxdoc implementation plan

## Current scope implemented

This scaffold establishes Phase 0 and the first deterministic pieces of Phase 1/2:

- pnpm monorepo structure matching the product spec.
- Strict TypeScript workspace configuration.
- Cloudflare Worker skeleton with `/health` and initial `/api/v1` document/source/tree/preview/session endpoints.
- Durable Object collaboration room implemented with `y-partyserver` (`DocumentRoom extends YServer`).
- Cloudflare Artifacts Git repo commits for source/tree/snapshot versions. R2 has been removed from the canonical artifact path.
- D1 schema migration for MVP metadata plus job ledger.
- Pure TypeScript document-model package.
- Pure deterministic MDX package with parser, serializer, classifier, diagnostics, fixtures, golden round-trip tests, and MDX source ⇄ Tiptap-compatible ProseMirror JSON bridge.
- SDK and CLI skeleton. CLI `push` creates a changeset placeholder by default; `--apply` directly calls public source API.
- React web shell using `y-partyserver/react` provider for collaboration, plus WYSIWYG/source/preview surfaces.

## Architecture adjustment: DO + Cloudflare Artifacts + y-partyserver

The collaboration layer uses Cloudflare Durable Objects via `partyserver`/`y-partyserver`, and durable document versions are committed to Cloudflare Artifacts repos:

- Web connects with `useYProvider({ party: "document-room", prefix: "/collab", room: "doc:{workspaceId}:{documentId}" })` and binds Tiptap Collaboration to the `prosemirror` Y.XmlFragment.
- Worker routes `/collab/:party/:room` via `routePartykitRequest`.
- `DocumentRoom` extends `YServer` and implements:
  - `onLoad`: load latest Yjs snapshot artifact from the document's Cloudflare Artifacts repo.
  - `onSave`: commit compact hot Yjs snapshots to the document's Artifacts repo and enqueue snapshot metadata job.
  - `onCustomMessage`: first-class non-Yjs realtime events for presence/comments/suggestions.

Cloudflare Artifacts is now the versioned artifact substrate: each document maps to an Artifacts Git repo named `mdxdoc-{workspaceId}-{documentId}`. Source, normalized tree JSON, manifests, and Yjs snapshots are committed under `versions/{version}/`. R2 is intentionally not part of the canonical storage path.

## Next tickets

1. Replace textarea WYSIWYG placeholder with Tiptap + y-prosemirror binding.
2. Expand the current Markdown/MDX ⇄ ProseMirror/Y.XmlFragment bridge with custom Tiptap nodes for known/unknown MDX cards instead of source-backed code blocks.
3. Add source-diff changeset creation and accept/reject application.
4. Add websocket event validation for comments/suggestions.
5. Add Miniflare/Workers runtime integration tests in addition to the current local D1/Artifacts fakes.
6. Add Playwright two-browser collaboration E2E.
7. Harden preview rendering with real MDX compile/sanitize pipeline.
8. Implement job ledger idempotency in queue consumers.
