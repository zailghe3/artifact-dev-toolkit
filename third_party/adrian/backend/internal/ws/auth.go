// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package ws

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"github.com/secureagentics/Adrian/backend/internal/store"
)

// authCtxKey is the context key under which the resolved api-key row
// is stashed by AuthMiddleware so the WS handler can read it.
type authCtxKey struct{}

// authedKey returns the *store.APIKey stashed by AuthMiddleware, or
// nil if the request did not pass through the middleware.
func authedKey(ctx context.Context) *store.APIKey {
	v, _ := ctx.Value(authCtxKey{}).(*store.APIKey)
	return v
}

// AuthMiddleware validates the `Authorization: Bearer <key>` header
// against the api_keys table. On success the *store.APIKey is stored
// in the request context. On miss / malformed / revoked it writes a
// 401 with a `WWW-Authenticate: Bearer` header and returns without
// invoking next.
func AuthMiddleware(s *store.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, err := extractBearer(r.Header.Get("Authorization"))
			if err != nil {
				unauth(w, "missing or malformed Authorization header")
				return
			}
			sum := sha256.Sum256([]byte(token))
			key, err := s.LookupAPIKey(r.Context(), hex.EncodeToString(sum[:]))
			if err != nil {
				if errors.Is(err, store.ErrNotFound) {
					unauth(w, "invalid api key")
					return
				}
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			ctx := context.WithValue(r.Context(), authCtxKey{}, key)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func extractBearer(authHeader string) (string, error) {
	if authHeader == "" {
		return "", errors.New("empty header")
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(authHeader, prefix) {
		return "", errors.New("not a Bearer token")
	}
	tok := strings.TrimSpace(authHeader[len(prefix):])
	if tok == "" {
		return "", errors.New("empty bearer token")
	}
	return tok, nil
}

func unauth(w http.ResponseWriter, reason string) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	http.Error(w, reason, http.StatusUnauthorized)
}
