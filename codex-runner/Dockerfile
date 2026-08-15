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
ENV CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2
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
    python3 scripts/build_codex_package.py --target x86_64-unknown-linux-gnu --cargo-profile dev-small --variant codex --package-dir /out/codex-package && \
    python3 -c 'import json; p=json.load(open("/out/codex-package/codex-package.json")); expected={"layoutVersion":1,"version":"0.147.0","target":"x86_64-unknown-linux-gnu","variant":"codex","entrypoint":"bin/codex"}; assert all(p.get(k)==v for k,v in expected.items()), "invalid Codex package metadata"' && \
    test -x /out/codex-package/bin/codex && test -d /out/codex-package/codex-resources && test -d /out/codex-package/codex-path && \
    readelf -l /out/codex-package/bin/codex | grep -Eq 'Requesting program interpreter: .*/ld-linux-x86-64\.so\.2' && \
    readelf -d /out/codex-package/bin/codex | grep -Eq 'Shared library: \[libc\.so\.6\]'

# ADT-owned probe is isolated so source changes cannot invalidate the canonical Codex build.
FROM rust:1.93.1-bookworm AS auth-probe-build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /probe
COPY auth-probe/Cargo.toml ./
COPY auth-probe/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/usr/local/cargo/git --mount=type=cache,target=/probe/target \
    cargo build --release && \
    install -D -m 0755 target/release/adt-codex-auth-probe /out/adt-codex-auth-probe && \
    test -x /out/adt-codex-auth-probe

FROM node:24-bookworm-slim
ARG CODEX_RUNNER_VERSION=development
LABEL org.opencontainers.image.source="https://github.com/zailghe3/artifact-dev-toolkit" \
      org.opencontainers.image.revision="$CODEX_RUNNER_VERSION"
ENV NODE_ENV=production CODEX_HOME=/data/codex PORT=8789 CODEX_RUNNER_VERSION=$CODEX_RUNNER_VERSION
COPY --from=codex-gnu-build /out/codex-package /opt/codex
COPY --from=auth-probe-build /out/adt-codex-auth-probe /usr/local/bin/adt-codex-auth-probe
COPY gai.conf /tmp/gai.conf
COPY --from=build /build/dist/validate-device-auth-schema.js /tmp/validate-device-auth-schema.js
# Validate and install the unchanged image-local address policy.
RUN test "$(grep -Ec '^precedence[[:space:]]+' /tmp/gai.conf)" = 5 && \
    grep -Eq '^precedence[[:space:]]+::1/128[[:space:]]+50$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::/0[[:space:]]+40$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+2002::/16[[:space:]]+30$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::/96[[:space:]]+20$' /tmp/gai.conf && \
    grep -Eq '^precedence[[:space:]]+::ffff:0:0/96[[:space:]]+100$' /tmp/gai.conf && \
    ! grep -Eiq 'openai|cloudflare|([0-9]{1,3}\.){3}[0-9]{1,3}' /tmp/gai.conf && \
    install -m 0644 /tmp/gai.conf /etc/gai.conf && rm /tmp/gai.conf
# Satisfy Codex 0.147's configured-home contract before executing the CLI.
RUN mkdir -p /data/codex && test -d /data/codex && chown -R node:node /data/codex
# Install exactly one authoritative Codex entrypoint without executing it.
RUN ln -s /opt/codex/bin/codex /usr/local/bin/codex && \
    test "$(command -v codex)" = /usr/local/bin/codex && \
    test ! -e /usr/bin/codex && \
    test ! -e /usr/local/lib/node_modules/@openai/codex
# Install only the OpenSSL runtime and Debian system trust store.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    dpkg-query -W -f='${Status}\n' ca-certificates | grep -Fxq 'install ok installed' && \
    test -f /etc/ssl/certs/ca-certificates.crt && \
    test -r /etc/ssl/certs/ca-certificates.crt && \
    test -s /etc/ssl/certs/ca-certificates.crt && \
    grep -m 1 -Fq -- '-----BEGIN CERTIFICATE-----' /etc/ssl/certs/ca-certificates.crt
# Validate the probe offline; never execute its live diagnostic during a build.
RUN test -f /usr/local/bin/adt-codex-auth-probe && \
    test -x /usr/local/bin/adt-codex-auth-probe && \
    probe_ldd="$(ldd /usr/local/bin/adt-codex-auth-probe 2>&1)" && \
    ! printf '%s\n' "$probe_ldd" | grep -Fq 'not found'
# Prove the copied executable's dynamic dependency closure in the slim image.
RUN codex_ldd="$(ldd /opt/codex/bin/codex 2>&1)"; codex_ldd_status=$?; \
    missing_sonames="$(printf '%s\n' "$codex_ldd" | sed -nE 's/^[[:space:]]*([A-Za-z0-9_.+-]+)[[:space:]]+=>[[:space:]]+not found[[:space:]]*$/\1/p' | sort -u)"; \
    if test -n "$missing_sonames"; then \
      printf '%s\n' "$missing_sonames" | sed 's/^/codex_runtime_missing_soname=/' >&2; \
      exit 1; \
    fi; \
    test "$codex_ldd_status" = 0 || { echo codex_runtime_ldd_failed >&2; exit 1; }; \
    printf '%s\n' "$codex_ldd" | grep -Eq 'libc\.so\.6' || { echo codex_runtime_not_glibc_dynamic >&2; exit 1; }; \
    ! printf '%s\n' "$codex_ldd" | grep -Fq 'not found' || { echo codex_runtime_dependencies_missing >&2; exit 1; }
# Execute the installed CLI and require the exact pinned version.
RUN codex_version="$(codex --version)" && \
    printf '%s\n' "$codex_version" && \
    test "$(printf '%s\n' "$codex_version" | sed -E 's/^(codex-cli |codex )?//')" = 0.147.0
# Generate and validate schemas through the installed GNU CLI.
RUN node /tmp/validate-device-auth-schema.js codex && rm /tmp/validate-device-auth-schema.js
# Record only the bounded, build-validated libc classification.
RUN install -d -m 0755 /etc/codex-runner && \
    printf 'glibc\n' >/etc/codex-runner/codex-native-libc && \
    chmod 0444 /etc/codex-runner/codex-native-libc
WORKDIR /app
COPY --from=build --chown=node:node /build/package.json /build/package-lock.json ./
COPY --from=build --chown=node:node /build/dist ./dist
ENV CODEX_DEVICE_AUTH_COMPATIBLE=1 CODEX_RUNNER_ADDRESS_POLICY=ipv4_preferred
USER node
VOLUME ["/data/codex"]
EXPOSE 8789
CMD ["node","dist/server.js"]
