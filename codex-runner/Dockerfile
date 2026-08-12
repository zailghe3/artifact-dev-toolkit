# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

# rust-v0.147.0 dereferences to this commit. The release used Rust 1.93.1;
# compilation uses OpenAI's unchanged package builder and supported GNU target.
FROM rust:1.93.1-bookworm AS codex-gnu-build
ARG TARGETARCH
ARG CODEX_SOURCE_COMMIT=be6e8eac029b183056b7e4402879f15d2c85f61b
RUN test "$TARGETARCH" = amd64 || { echo 'Codex GNU build supports linux/amd64 only' >&2; exit 1; }
RUN apt-get update && apt-get install -y --no-install-recommends binutils git python3 pkg-config libssl-dev libcap-dev clang && rm -rf /var/lib/apt/lists/*
WORKDIR /source
RUN git init && git remote add origin https://github.com/openai/codex.git && \
    git fetch --depth 1 origin "$CODEX_SOURCE_COMMIT" && git checkout --detach FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = "$CODEX_SOURCE_COMMIT"
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/source/codex-rs/target \
    --mount=type=cache,target=/tmp/codex-package \
    python3 scripts/build_codex_package.py --target x86_64-unknown-linux-gnu --cargo-profile release --variant codex --package-dir /out/codex-package && \
    python3 -c 'import json; p=json.load(open("/out/codex-package/codex-package.json")); expected={"layoutVersion":1,"version":"0.147.0","target":"x86_64-unknown-linux-gnu","variant":"codex","entrypoint":"bin/codex"}; assert all(p.get(k)==v for k,v in expected.items()), "invalid Codex package metadata"' && \
    test -x /out/codex-package/bin/codex && test -d /out/codex-package/codex-resources && test -d /out/codex-package/codex-path && \
    readelf -l /out/codex-package/bin/codex | grep -Eq 'Requesting program interpreter: .*/ld-linux-x86-64\.so\.2' && \
    readelf -d /out/codex-package/bin/codex | grep -Eq 'Shared library: \[libc\.so\.6\]'

FROM node:24-bookworm-slim
ARG CODEX_RUNNER_VERSION=development
LABEL org.opencontainers.image.source="https://github.com/zailghe3/artifact-dev-toolkit" \
      org.opencontainers.image.revision="$CODEX_RUNNER_VERSION"
ENV NODE_ENV=production CODEX_HOME=/data/codex PORT=8789 CODEX_RUNNER_VERSION=$CODEX_RUNNER_VERSION
COPY --from=codex-gnu-build /out/codex-package /opt/codex
COPY gai.conf /tmp/gai.conf
COPY --from=build /build/dist/validate-device-auth-schema.js /tmp/validate-device-auth-schema.js
RUN test "$(grep -Ec '^precedence[[:space:]]+' /tmp/gai.conf)" = 5 && \
    grep -Eq '^precedence[[:space:]]+::1/128[[:space:]]+50$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::/0[[:space:]]+40$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+2002::/16[[:space:]]+30$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::/96[[:space:]]+20$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::ffff:0:0/96[[:space:]]+100$' /tmp/gai.conf && \
    ! grep -Eiq 'openai|cloudflare|([0-9]{1,3}\.){3}[0-9]{1,3}' /tmp/gai.conf && \
    install -m 0644 /tmp/gai.conf /etc/gai.conf && rm /tmp/gai.conf && \
    ln -s /opt/codex/bin/codex /usr/local/bin/codex && \
    test "$(command -v codex)" = /usr/local/bin/codex && test ! -e /usr/bin/codex && \
    test ! -e /usr/local/lib/node_modules/@openai/codex && \
    test "$(codex --version | sed -E 's/^(codex-cli |codex )?//')" = 0.147.0 && \
    node /tmp/validate-device-auth-schema.js codex && rm /tmp/validate-device-auth-schema.js && \
    install -d -m 0755 /etc/codex-runner && printf 'glibc\n' >/etc/codex-runner/codex-native-libc && chmod 0444 /etc/codex-runner/codex-native-libc && \
    mkdir -p /data/codex && chown -R node:node /data/codex
WORKDIR /app
COPY --from=build --chown=node:node /build/package.json /build/package-lock.json ./
COPY --from=build --chown=node:node /build/dist ./dist
ENV CODEX_DEVICE_AUTH_COMPATIBLE=1 CODEX_RUNNER_ADDRESS_POLICY=ipv4_preferred
USER node
VOLUME ["/data/codex"]
EXPOSE 8789
CMD ["node","dist/server.js"]
