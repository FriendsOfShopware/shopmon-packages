# Shopmon Packages

A Cloudflare Worker that mirrors and caches Shopware store packages, allowing multiple tokens to share a single package cache backed by Cloudflare R2 and D1.

## Features

- **Package Mirroring** - Syncs packages from `packages.shopware.com` and stores them in Cloudflare R2
- **Multi-Token Support** - Register multiple Shopware account tokens, each with their own package access scope
- **Composer-Compatible** - Serves a Composer repository API (`packages.json`, `/p2/` metadata, `/download/` endpoints)
- **Automatic Sync** - Hourly cron trigger keeps packages up to date via Cloudflare Queues
- **Admin API** - Manage tokens via a separate admin API secured with a static API token

## Architecture

- **Runtime**: Cloudflare Workers (Hono)
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Storage**: Cloudflare R2
- **Queue**: Cloudflare Queues for background sync and downloads

## Setup

```bash
npm install
cp wrangler.jsonc wrangler.jsonc  # adjust D1/R2/Queue bindings as needed
```

Create the D1 database and R2 bucket, then run migrations:

```bash
wrangler d1 migrations apply packages-mirror
```

Set the `API_TOKEN` secret for admin API authentication:

```bash
wrangler secret put API_TOKEN
```

## Development

```bash
npm run dev
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

### Admin Endpoints (Bearer `API_TOKEN` auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tokens` | Register a new Shopware store token |
| `GET` | `/api/tokens` | List all tokens |
| `DELETE` | `/api/tokens/:id` | Delete a token |
| `POST` | `/api/tokens/:id/sync` | Trigger sync for a specific token |
| `GET` | `/api/sync` | Trigger sync for all tokens |

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
