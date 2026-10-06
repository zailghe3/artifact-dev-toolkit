// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/secureagentics/Adrian/backend/internal/store"
)

// Cookie name carrying the opaque session token.
const sessionCookieName = "adrian_token"

type ctxKey string

const (
	ctxUserID     ctxKey = "user_id"
	ctxSessionID  ctxKey = "session_id"
	ctxMustChange ctxKey = "must_change_password"
)

// userID returns the authenticated user id from the request context,
// or "" if RequireSession did not run.
func userID(r *http.Request) string {
	v, _ := r.Context().Value(ctxUserID).(string)
	return v
}

// sessionID returns the current session token from the context.
func sessionID(r *http.Request) string {
	v, _ := r.Context().Value(ctxSessionID).(string)
	return v
}

// mustChange returns true when the authenticated user has not yet
// completed first-login password rotation.
func mustChange(r *http.Request) bool {
	v, _ := r.Context().Value(ctxMustChange).(bool)
	return v
}

// extractToken pulls the session token from `Authorization: Bearer`
// or the `adrian_token` cookie. Bearer takes precedence so CLI
// clients can pass a token without a cookie jar.
func extractToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if c, err := r.Cookie(sessionCookieName); err == nil {
		return c.Value
	}
	return ""
}

// RequireSession validates the session token and attaches the user id
// to the request context. Returns 401 on miss / expired. Adds the
// must_change_password gate: when set, every route except
// /api/auth/change-password and /api/auth/logout returns 403 with
// `{"error":"must_change_password"}`.
func RequireSession(st *store.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok := extractToken(r)
			if tok == "" {
				writeError(w, http.StatusUnauthorized, "missing token")
				return
			}
			sess, err := st.LookupSession(r.Context(), tok)
			if err != nil {
				if errors.Is(err, store.ErrNotFound) {
					writeError(w, http.StatusUnauthorized, "invalid or expired token")
					return
				}
				writeError(w, http.StatusInternalServerError, "session lookup failed")
				return
			}
			user, err := st.LookupUserByID(r.Context(), sess.UserID)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "user not found")
				return
			}

			ctx := r.Context()
			ctx = context.WithValue(ctx, ctxUserID, user.ID)
			ctx = context.WithValue(ctx, ctxSessionID, sess.ID)
			ctx = context.WithValue(ctx, ctxMustChange, user.MustChangePassword)

			if user.MustChangePassword && !isPasswordChangeAllowed(r.URL.Path) {
				writeError(w, http.StatusForbidden, "must_change_password")
				return
			}

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// isPasswordChangeAllowed returns true for the routes a
// must-change-password user is allowed to hit before resetting.
func isPasswordChangeAllowed(path string) bool {
	return path == "/api/auth/change-password" || path == "/api/auth/logout"
}
