# mdxdoc beta runbook

## Before beta

1. Create D1 database and replace `database_id` in `apps/api/wrangler.toml`.
2. Apply `migrations/0001_initial.sql`.
3. Create/configure Cloudflare Artifacts namespace and bind it as `ARTIFACTS`.
4. Configure Durable Object migration for `DocumentRoom`.
5. Create queues: `mdxdoc-snapshot`, `mdxdoc-export`, `mdxdoc-notification`, `mdxdoc-dlq`.
6. Deploy API staging with Wrangler.
7. Deploy web staging with `VITE_API_URL` and `VITE_COLLAB_HOST` pointing at API.
8. Run `pnpm test` and `pnpm typecheck`.
9. Run CLI smoke: `mdxdoc health --api-url <staging-api>`.
10. Verify source/tree/snapshot files are committed under each document Artifacts repo `versions/{version}/...`.

## Rollback

1. Disable new writes if data integrity is at risk.
2. Keep reads and exports enabled.
3. Stop queue consumers if they cause corruption.
4. Preserve Cloudflare Artifacts repos and document version metadata.
5. Roll back Worker deployment.
6. Restore by appending a new version from latest safe artifact.
7. Publish incident note with affected document IDs.
