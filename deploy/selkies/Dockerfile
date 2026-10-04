# syntax=docker/dockerfile:1
ARG DESKTOP_IMAGE=lscr.io/linuxserver/chromium@sha256:35e67a28573b13269bb96f9e8464411b4b71467ce46a055a4d584ab5d2c0f06f
FROM --platform=$TARGETPLATFORM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS node-runtime
FROM --platform=$BUILDPLATFORM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global bun@1.4.2
WORKDIR /app
COPY package.json bun.lock upstream.lock.json .gitmodules ./
COPY apps ./apps
COPY packages ./packages
COPY patches ./patches
COPY scripts ./scripts
COPY tools ./tools
RUN git init upstream/open-pencil && git -C upstream/open-pencil remote add origin https://github.com/open-pencil/open-pencil.git \
 && git -C upstream/open-pencil fetch --depth=1 origin "$(node -p 'JSON.parse(require("fs").readFileSync("upstream.lock.json")).sha')" \
 && git -C upstream/open-pencil checkout --detach FETCH_HEAD
RUN bun install --frozen-lockfile && npm run verify-upstream && npm run build
FROM build AS dependencies
RUN rm -rf node_modules && bun install --production --frozen-lockfile

FROM --platform=$TARGETPLATFORM ${DESKTOP_IMAGE} AS runtime
# The desktop image is used as a component source. Its root /init, nginx, Docker,
# terminal, sudo and default Chromium launcher are never started.
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
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/tools/filesystem /app/tools/filesystem
COPY --from=build /app/tools/remote /app/tools/remote
COPY deploy/selkies/chromium-policy.json /etc/chromium/policies/managed/portal.json
COPY deploy/selkies/versions.json /app/versions.json
WORKDIR /app
ENV NODE_ENV=production PORTAL_CONFIG=/config/config.json PYTHON_BIN=python3 \
    HOME=/state/remote START_DOCKER=false PIXELFLUX_WAYLAND=false
LABEL org.opencontainers.image.title="OpenPencil Selkies read-only Portal" \
      org.opencontainers.image.version="0.1.0-selkies" \
      portal.upstream.sha="8c72b62da07ea1f7e82de84c7c837c3c78dfbf95"
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["node","/app/dist/api/server.js"]
