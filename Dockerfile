# syntax=docker/dockerfile:1
# One image per process type, built from the same frozen install. Configuration comes
# only from environment variables (see .env.example); no secret is baked into an image.
#
#   docker build --target api --build-arg VALO_RELEASE_SHA=<commit> -t valo-api:<commit> .
#   docker build --target web --build-arg VALO_RELEASE_SHA=<commit> \
#     --build-arg CLERK_PUBLISHABLE_KEY=pk_test_... -t valo-web:<commit> .
#
# The API image runs the API by default and also holds the worker and operator
# commands. Run the supervised worker with
#   docker run ... valo-api:<commit> node --enable-source-maps dist/export-supervisor.mjs
# See docs/valo/release-and-rollback.md before using an image anywhere but CI.
#
# Dependencies are only ever installed from the frozen lockfile, so the supply-chain
# rules in pnpm-workspace.yaml apply unchanged. `pnpm deploy` is not used because it
# resolves versions again instead of using the lockfile.

FROM node:24-bookworm-slim AS build
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile

# The API bundle, then only the API's production dependencies, reinstalled offline
# from the store the full install filled.
FROM build AS api-build
RUN pnpm --filter @workspace/api-server run build \
 && find . -name node_modules -type d -prune -exec rm -rf {} + \
 && pnpm install --frozen-lockfile --offline --prod --filter @workspace/api-server

FROM node:24-bookworm-slim AS api
ARG VALO_RELEASE_SHA=unknown
LABEL org.opencontainers.image.revision="$VALO_RELEASE_SHA"
ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/valo-chromium
WORKDIR /repo/artifacts/api-server
COPY --from=api-build /repo/node_modules /repo/node_modules
COPY --from=api-build /repo/artifacts/api-server/package.json ./
COPY --from=api-build /repo/artifacts/api-server/node_modules ./node_modules
COPY --from=api-build /repo/artifacts/api-server/dist ./dist
# Chromium and its system libraries for PDF rendering, matching the locked Playwright.
RUN node node_modules/playwright/cli.js install --with-deps chromium \
 && apt-get update && apt-get install -y --no-install-recommends poppler-utils \
 && ln -s "$(node -e "process.stdout.write(require('playwright').chromium.executablePath())")" "$CHROMIUM_EXECUTABLE_PATH" \
 && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

FROM build AS web-build
# The publishable key is public: Clerk sends it to every browser. BuildKit warns about any
# build argument whose name ends in KEY; never pass the secret key here.
ARG CLERK_PUBLISHABLE_KEY=""
ARG BASE_PATH="/"
RUN CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" BASE_PATH="$BASE_PATH" pnpm --filter @workspace/valo run build

# React and the UI libraries are dev dependencies of the web app, so the web image keeps
# the full install. Next.js starts directly; pnpm is not needed at runtime.
FROM node:24-bookworm-slim AS web
ARG VALO_RELEASE_SHA=unknown
LABEL org.opencontainers.image.revision="$VALO_RELEASE_SHA"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=web-build /repo /repo
RUN chown -R node:node /repo/artifacts/valo/.next
WORKDIR /repo/artifacts/valo
USER node
EXPOSE 3000
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port \"${PORT}\""]
