# Shopmon Packages

A Cloudflare Worker that mirrors and caches Shopware store packages, allowing multiple tokens to share a single package cache backed by Cloudflare R2 and D1.

## Features

- **Package Mirroring** - Syncs packages from `packages.shopware.com` and stores them in Cloudflare R2
- **Multi-Token Support** - Register multiple Shopware account tokens, each with their own package access scope
- **Composer-Compatible** - Serves a Composer repository API (`packages.json`, `/p2/` metadata, `/download/` endpoints)
- **Automatic Sync** - Hourly cron trigger keeps packages up to date via Cloudflare Queues
- **Admin API** - Manage tokens via a separate admin API secured with a static API token
- **Public Package Browser** - A Vue frontend at `/` lists all mirrored packages and versions

## Architecture

- **Runtime**: Cloudflare Workers (Hono)
- **Frontend**: Vue 3 + Vite + shadcn-vue, served as Worker static assets from `frontend/dist`
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Storage**: Cloudflare R2
- **Queue**: Cloudflare Queues for background sync and downloads

## File checksums

Each new package download stores two objects in R2:

- `packages/{vendor/name}/{version}.zip` — the original archive
- `packages/{vendor/name}/{version}.checksums.json` — checksums of the uncompressed file contents

The manifest uses **XXH128 (XXH3-128, seed 0)**, encoded as 32 lowercase hexadecimal characters, compatible with PHP's `hash('xxh128', $contents)`:

```json
{
  "algorithm": "xxh128",
  "files": {
    "Plugin/src/Example.php": "06b05ab6733a618578af5f94892f3950"
  }
}
```

Paths are preserved exactly as stored in the ZIP, including any top-level plugin directory. Directory entries are omitted; empty files are included. Checksums cover contents, not permissions or other ZIP metadata. Manifests are stored in R2 and publicly readable without authentication at `/api/public/checksums/{vendor}/{name}/{version}`; the Composer ZIP download endpoint remains authenticated and unchanged.

Successful checksum responses use `Cache-Control: public, max-age=31536000, immutable` (one year) and include the R2 object's `ETag`. Missing manifests return `404` with `Cache-Control: no-store`, so a later backfill can make them available. HTTP caching is not literally permanent—caches may evict entries—but clients can reuse a versioned manifest for a year without revalidation. Treat published manifests as immutable: replacing one at the same URL can leave clients with the previous cached contents.

```bash
curl https://packages.fos.gg/api/public/checksums/store/my-plugin/1.2.0
```

Files are decompressed and hashed incrementally using bounded R2 range reads. Invalid/corrupt archives, encrypted files, unsafe or duplicate paths, and archives exceeding the processing limits (10,000 entries, 512 MiB total uncompressed contents, 8 MiB per range read) are rejected without publishing a new package in D1. A package is published only after both objects are stored. Retried download jobs recover missing manifests from the existing ZIP without downloading it again.

### Backfill existing ZIPs

Normal sync skips versions already indexed in D1. After deploying, start a backfill with the admin `API_TOKEN`:

```bash
curl --fail-with-body -X POST \
  https://packages.fos.gg/api/checksums/backfill \
  -H "Authorization: Bearer $API_TOKEN"
```

The endpoint returns HTTP **202** with `{"message":"Checksum backfill enqueued"}` once the first scan job is queued. Processing continues asynchronously on the existing download queue:

- Scans R2's `packages/` prefix in pages of up to 100 objects, queuing subsequent pages automatically.
- Queues a checksum job for each `.zip`, including ZIPs not indexed in D1.
- Skips existing manifests; otherwise reads the ZIP directly from R2 and writes the adjacent `.checksums.json` file. No upstream downloads, Shopware tokens, or D1 updates are involved.
- Retries failed jobs using the existing queue retry policy. ZIPs deleted after scanning are skipped; invalid archives fail without writing a manifest.

It is safe to rerun the endpoint after an interrupted backfill; existing manifests are not regenerated. Repeated runs still incur R2 listing and queue operations. No database migration or additional binding is required.

Worker logs include `checksum-backfill-page` (scanned/enqueued counts and whether more pages remain), `checksum-backfill-generated`, and `checksum-backfill-missing-zip`. A final scan page does not mean every generation job has finished; monitor the queue backlog and processing errors as well. The endpoint does not currently expose job status.

**Security:** XXH128 is non-cryptographic. These checksums detect content changes but are not proof of authenticity or protection against deliberate tampering. For adversarial integrity verification, use a cryptographic hash (such as SHA-256) with a trusted or signed manifest.

## Security advisories

`packages.json` advertises the Composer security advisory API at `/security-advisories.json`.
It accepts public GET query parameters or form-encoded POST requests with `packages[]`
(including Composer's indexed `packages[0]` encoding), and returns full advisories grouped
by package name. Composer evaluates the `affectedVersions` constraints itself.
Unknown packages are omitted; an empty table returns `{"advisories":{}}`.
Responses use `Cache-Control: no-store` so external updates appear immediately.
Requests are limited to 1 MiB and 1,000 distinct package names.

```bash
curl https://packages.fos.gg/security-advisories.json \
  --data-urlencode 'packages[]=store/my-plugin'
```

Apply migration `drizzle/0002_security_advisories.sql` with the existing D1 migrations
before deploying. The `security_advisories` table is intentionally empty and will be
populated externally; there is no importer or write API. It has no foreign key to
mirrored packages, so advisories can be imported before their packages are mirrored.

External writers should upsert on `(package_name, advisory_id)`. Required columns are
`package_name` (lowercase Composer name), `advisory_id` (stable identifier),
`affected_versions` (Composer constraint), `title`, `reported_at` (RFC 3339 timestamp),
and `sources` (JSON array of `{ "name": "source-name", "remoteId": "source-id" }`,
with at least one source). `cve`, `link`, and `severity` are nullable; use Composer
severity values `low`, `medium`, `high`, or `critical` when known. `id` is generated.

```sql
INSERT INTO security_advisories
  (package_name, advisory_id, affected_versions, title, reported_at, sources, severity)
VALUES
  ('store/my-plugin', 'EXAMPLE-001', '<1.2.3', 'Example vulnerability',
   '2026-10-21T00:00:00Z', '[{"name":"example","remoteId":"EXAMPLE-001"}]', 'high')
ON CONFLICT (package_name, advisory_id) DO UPDATE SET
  affected_versions = excluded.affected_versions,
  title = excluded.title,
  reported_at = excluded.reported_at,
  sources = excluded.sources,
  severity = excluded.severity;
```

## Setup

```bash
npm install
# Adjust D1/R2/Queue bindings in cloudflare.config.ts as needed.
```

Create the D1 database and R2 bucket, then run migrations:

```bash
npx cf d1 migrations apply <DATABASE_ID> --dir drizzle
```

Set the `API_TOKEN` secret for admin API authentication:

```bash
npx cf deploy --secrets-file .env
```

## Development

```bash
npm run build:frontend  # build the static frontend once (cf serves it from frontend/dist)
npm run dev
```

For frontend work with hot reload, run the Vite dev server alongside `npm run dev` (API requests are proxied to the worker on port 8787):

```bash
npm run dev:frontend
```

## Deployment

```bash
npm run deploy
```

## API

### Composer Endpoints (Bearer token auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/packages.json` | List available packages for the token |
| `GET` | `/p2/{vendor/name}.json` | Package metadata |
| `GET` | `/download/{vendor/name}/{version}` | Download a package zip |

### Public Endpoints (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Package browser frontend |
| `GET`, `POST` | `/security-advisories.json` | Composer security advisories for requested packages |
| `GET` | `/api/public/packages` | List all mirrored packages and versions |
| `GET` | `/api/public/packages/{vendor}/{name}` | Package details with per-version release date and Shopware core compatibility |
| `GET` | `/api/public/checksums/{vendor}/{name}/{version}` | Public XXH128 file manifest with one-year immutable caching |

### Admin Endpoints (Bearer `API_TOKEN` auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tokens` | Register a new Shopware store token |
| `GET` | `/api/tokens` | List all tokens |
| `DELETE` | `/api/tokens/:id` | Delete a token |
| `POST` | `/api/tokens/:id/sync` | Trigger sync for a specific token |
| `GET` | `/api/sync` | Trigger sync for all tokens |
| `POST` | `/api/checksums/backfill` | Queue checksum generation for existing R2 ZIPs (202 Accepted) |

### Usage with Composer

Add the mirror as a repository in your `composer.json` (or `auth.json`):

```json
{
    "repositories": [
        {
            "type": "composer",
            "url": "https://packages.fos.gg"
        }
    ]
}
```

Authenticate using a registered token:

```bash
composer config --auth bearer.packages.fos.gg <your-token>
```

## License

MIT - see [LICENSE](LICENSE)
