# Runs the worker locally via `wrangler dev`, which executes it on the
# workerd runtime (through miniflare) with D1, R2 and Queues simulated.

# --- deps stage: install node_modules with good layer caching ---
FROM node:24-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# --- runtime stage ---
FROM node:24-slim

WORKDIR /app

ENV CI=true

# Reuse the installed dependencies, then add the source.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 8787

# Local D1, R2 and Queue state lives here; declare it as a volume so it
# persists across container runs (or mount your own with -v).
VOLUME ["/app/.wrangler"]

# If an API_TOKEN is provided, expose it to the worker via .dev.vars.
# Apply D1 migrations against the local store, then start the dev server
# bound to all interfaces so it is reachable from outside the container.
ENTRYPOINT ["sh", "-c", "if [ -n \"$API_TOKEN\" ]; then echo \"API_TOKEN=$API_TOKEN\" > .dev.vars; fi && npx wrangler d1 migrations apply packages-mirror --local && npx wrangler dev --ip 0.0.0.0 --port 8787 --show-interactive-dev-session false"]
