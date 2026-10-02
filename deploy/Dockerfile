# CI builds the web assets; the NAS does not compile OpenPencil.
FROM --platform=$BUILDPLATFORM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS compiler-base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 && rm -rf /var/lib/apt/lists/*
FROM compiler-base AS build
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN npm install --global bun@1.4.2
WORKDIR /app
# Explicit source allowlist also keeps any operator JSON out of builder layers.
COPY package.json bun.lock upstream.lock.json .gitmodules ./
COPY apps ./apps
COPY packages ./packages
COPY patches ./patches
COPY scripts ./scripts
COPY tools ./tools
# Fetch only the exact locked commit, never a moving branch or local patches.
RUN git init upstream/open-pencil && git -C upstream/open-pencil remote add origin https://github.com/open-pencil/open-pencil.git \
 && git -C upstream/open-pencil fetch --depth=1 origin "$(node -p 'JSON.parse(require("fs").readFileSync("upstream.lock.json")).sha')" \
 && git -C upstream/open-pencil checkout --detach FETCH_HEAD
RUN bun install --frozen-lockfile && npm run verify-upstream && npm run build
FROM compiler-base AS dependencies
RUN npm install --global bun@1.4.2
WORKDIR /deps
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
# Locked production dependencies are JavaScript. Refuse common native addons;
# the target Node/Python binaries come from the target-platform base instead.
RUN test -z "$(find node_modules -type f -name '*.node' -print -quit)"
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 portal && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin portal
WORKDIR /app
COPY --from=dependencies /deps/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/tools/filesystem ./tools/filesystem
COPY --from=build /app/scripts/probe-nas.py ./tools/probe-nas.py
LABEL org.opencontainers.image.title="OpenPencil Synology LAN Portal" \
      org.opencontainers.image.version="0.1.0" \
      portal.upstream.sha="8c72b62da07ea1f7e82de84c7c837c3c78dfbf95"
ENV NODE_ENV=production PORTAL_CONFIG=/config/config.json PYTHON_BIN=python3
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","dist/api/server.js"]
