FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY . .

ENV CI=true

EXPOSE 8787

ENTRYPOINT ["sh", "-c", "if [ -n \"$API_TOKEN\" ]; then echo \"API_TOKEN=$API_TOKEN\" > .dev.vars; fi && npx wrangler d1 migrations apply packages-mirror --local && npx wrangler dev --ip 0.0.0.0 --show-interactive-dev-session false"]
