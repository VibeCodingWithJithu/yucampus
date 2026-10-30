# One image for the whole app (decided 2026-10-30): infra/production/docker-compose.yml runs it as the web app,
# the API, and the tools container (migrations, rules import, team accounts). See docs/DEPLOY.md.

# Node 24 LTS: the newest line Prisma supports.
FROM node:24-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# The pnpm version named in package.json.
RUN npm install -g pnpm@12.11.2 && npm cache clean --force
WORKDIR /app

FROM base AS build
COPY . .
# The web app reads these when it is built, not when it runs.
ARG NEXT_PUBLIC_ROOT_DOMAIN
ARG NEXT_PUBLIC_SSO_URL
ENV NEXT_PUBLIC_ROOT_DOMAIN=$NEXT_PUBLIC_ROOT_DOMAIN NEXT_PUBLIC_SSO_URL=$NEXT_PUBLIC_SSO_URL API_PROXY_TARGET=http://api:4000
RUN pnpm install --frozen-lockfile && pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
