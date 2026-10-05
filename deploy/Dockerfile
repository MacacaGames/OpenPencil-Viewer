# syntax=docker/dockerfile:1
# Every published tag includes raster + Selkies. Mode is a runtime config choice.
ARG DESKTOP_IMAGE=lscr.io/linuxserver/chromium@sha256:2d32e1b2b28aa92973aa0f58c433c0b045db6e1224d7001eeaa9cde1a474ce13
FROM --platform=$TARGETPLATFORM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS node-runtime
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
RUN git init upstream/open-pencil && git -C upstream/open-pencil remote add origin "$(node -p 'JSON.parse(require("fs").readFileSync("upstream.lock.json")).repository')" \
 && git -C upstream/open-pencil fetch --depth=1 origin "$(node -p 'JSON.parse(require("fs").readFileSync("upstream.lock.json")).sha')" \
 && git -C upstream/open-pencil checkout --detach FETCH_HEAD
RUN bun install --frozen-lockfile && npm run verify-upstream && npm run build
FROM compiler-base AS dependencies
RUN npm install --global bun@1.4.2
WORKDIR /deps
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
# Target Node/Python/desktop binaries come from their pinned platform manifests.
RUN test -z "$(find node_modules -type f -name '*.node' -print -quit)"
FROM --platform=$TARGETPLATFORM ${DESKTOP_IMAGE} AS runtime
# Use desktop components, never the base image's root /init or Docker daemon.
RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources \
 && printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260930T000000Z/ trixie main\n' > /etc/apt/sources.list.d/portal.list \
 && apt-get update && apt-get install -y --no-install-recommends ffmpeg vainfo mesa-utils \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 portal && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin portal \
 && rm -f /etc/sudoers.d/* && chmod 000 /usr/bin/sudo \
 && mkdir -p /app/tools/remote/empty /etc/chromium/policies/managed \
 && dpkg-query -W > /app/runtime-packages.txt \
 && /lsiopy/bin/python -c 'import importlib.metadata as m; assert m.version("selkies")=="2.0.0"; assert m.version("pixelflux")=="2.1.0"'
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=dependencies /deps/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/tools/filesystem ./tools/filesystem
COPY --from=build /app/scripts/probe-nas.py ./tools/probe-nas.py
COPY --from=build /app/tools/nas ./tools/nas
COPY --from=build /app/tools/remote ./tools/remote
COPY deploy/selkies/chromium-policy.json /etc/chromium/policies/managed/portal.json
COPY deploy/selkies/versions.json /app/versions.json
LABEL org.opencontainers.image.title="OpenPencil LAN Portal" \
      org.opencontainers.image.version="0.1.0" \
      portal.features="raster,selkies" \
      portal.upstream.sha="e4ef22826ff238bba57eeeb7bc769d4a2d355ce1"
ENV NODE_ENV=production PORTAL_CONFIG=/config/config.json PYTHON_BIN=python3 \
    HOME=/state/remote START_DOCKER=false PIXELFLUX_WAYLAND=false
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["node","/app/dist/api/server.js"]
