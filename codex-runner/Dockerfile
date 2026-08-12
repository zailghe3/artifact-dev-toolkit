# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

# This gate examines the executable shipped by the exact npm release, rather
# than trusting its package/directory name. It deliberately precedes replacement.
FROM node:24-bookworm-slim AS npm-musl-confirmation
RUN apt-get update && apt-get install -y --no-install-recommends binutils && rm -rf /var/lib/apt/lists/* && \
    npm install --global @openai/codex@0.147.0 && \
    native="$(find /usr/local/lib/node_modules/@openai -type f -name codex -perm /111 | head -n 1)" && \
    test -n "$native" && readelf -l "$native" | grep -Eq 'Requesting program interpreter: .*musl' && \
    printf 'musl\n' >/npm-codex-libc

# rust-v0.147.0 dereferences to this commit. The release used Rust 1.93.1;
# compilation uses OpenAI's unchanged package builder and supported GNU target.
FROM rust:1.93.1-bookworm AS codex-gnu-build
ARG TARGETARCH
ARG CODEX_SOURCE_COMMIT=be6e8eac029b183056b7e4402879f15d2c85f61b
RUN test "$TARGETARCH" = amd64 || { echo 'Codex GNU build supports linux/amd64 only' >&2; exit 1; }
RUN apt-get update && apt-get install -y --no-install-recommends binutils git python3 pkg-config libssl-dev clang && rm -rf /var/lib/apt/lists/*
WORKDIR /source
RUN git init && git remote add origin https://github.com/openai/codex.git && \
    git fetch --depth 1 origin "$CODEX_SOURCE_COMMIT" && git checkout --detach FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = "$CODEX_SOURCE_COMMIT"
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/source/codex-rs/target \
    python3 scripts/build_codex_package.py --target x86_64-unknown-linux-gnu --cargo-profile release && \
    package_bin="$(find . -path '*/bin/codex' -type f -perm /111 ! -path './codex-rs/target/*' | head -n 1)" && \
    test -n "$package_bin" && package_root="$(dirname "$(dirname "$package_bin")")" && \
    readelf -l "$package_bin" | grep -Eq 'Requesting program interpreter: .*/ld-linux-x86-64\.so\.2' && \
    readelf -d "$package_bin" | grep -Eq 'Shared library: \[libc\.so\.6\]' && \
    mkdir /opt/codex && cp -a "$package_root"/. /opt/codex/

FROM node:24-bookworm-slim
ARG CODEX_RUNNER_VERSION=development
LABEL org.opencontainers.image.source="https://github.com/zailghe3/artifact-dev-toolkit" \
      org.opencontainers.image.revision="$CODEX_RUNNER_VERSION"
ENV NODE_ENV=production CODEX_HOME=/data/codex PORT=8789 CODEX_RUNNER_VERSION=$CODEX_RUNNER_VERSION
COPY --from=npm-musl-confirmation /npm-codex-libc /tmp/npm-codex-libc
COPY --from=codex-gnu-build /opt/codex /opt/codex
COPY gai.conf /tmp/gai.conf
COPY --from=build /build/dist/validate-device-auth-schema.js /tmp/validate-device-auth-schema.js
RUN test "$(cat /tmp/npm-codex-libc)" = musl && rm /tmp/npm-codex-libc && \
    test "$(grep -Ec '^precedence[[:space:]]+' /tmp/gai.conf)" = 5 && \
    grep -Eq '^precedence[[:space:]]+::1/128[[:space:]]+50$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::/0[[:space:]]+40$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+2002::/16[[:space:]]+30$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::/96[[:space:]]+20$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::ffff:0:0/96[[:space:]]+100$' /tmp/gai.conf && \
    ! grep -Eiq 'openai|cloudflare|([0-9]{1,3}\.){3}[0-9]{1,3}' /tmp/gai.conf && \
    install -m 0644 /tmp/gai.conf /etc/gai.conf && rm /tmp/gai.conf && \
    ln -s /opt/codex/bin/codex /usr/local/bin/codex && \
    test "$(command -v codex)" = /usr/local/bin/codex && test ! -e /usr/bin/codex && \
    test "$(codex --version | sed -E 's/^(codex-cli |codex )?//')" = 0.147.0 && \
    node /tmp/validate-device-auth-schema.js codex && rm /tmp/validate-device-auth-schema.js && \
    mkdir -p /data/codex && chown -R node:node /data/codex
WORKDIR /app
COPY --from=build --chown=node:node /build/package.json /build/package-lock.json ./
COPY --from=build --chown=node:node /build/dist ./dist
ENV CODEX_DEVICE_AUTH_COMPATIBLE=1 CODEX_RUNNER_ADDRESS_POLICY=ipv4_preferred CODEX_RUNNER_CODEX_LIBC=glibc
USER node
VOLUME ["/data/codex"]
EXPOSE 8789
CMD ["node","dist/server.js"]
