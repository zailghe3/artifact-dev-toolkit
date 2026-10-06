# ADT-owned image recipe; third_party/adrian remains an unmodified upstream snapshot.
FROM golang:1.25.8-bookworm AS build
WORKDIR /src
COPY third_party/adrian/backend/go.mod third_party/adrian/backend/go.sum ./
RUN go mod download
COPY third_party/adrian/backend/ ./
ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /out/adrian ./cmd/adrian

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/adrian /adrian
COPY third_party/adrian/LICENSE /licenses/Adrian-LICENSE
VOLUME ["/data", "/models"]
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=6 CMD ["/adrian", "healthcheck"]
ENTRYPOINT ["/adrian"]
