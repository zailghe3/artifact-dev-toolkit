// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"

	"github.com/secureagentics/Adrian/backend/internal/store"
)

// writeAuditLog persists one audit row. Best-effort: a write failure
// logs warn but never bubbles to the caller. The audit trail is
// observability, not transactional, losing one row must never block
// the underlying action (policy update, key creation, etc.).
//
// Pass userID = "" for unauthenticated actions (login_failed). Pass
// details = nil for actions where action+target capture the picture.
func writeAuditLog(ctx context.Context, st *store.Store, userID, action, target string, details map[string]any) {
	var payload string
	if details != nil {
		buf, err := json.Marshal(details)
		if err != nil {
			slog.WarnContext(ctx, "audit_log.marshal_failed", "action", action, "error", err)
			payload = "{}"
		} else {
			payload = string(buf)
		}
	} else {
		payload = "{}"
	}

	var uid sql.NullString
	if userID != "" {
		uid = sql.NullString{String: userID, Valid: true}
	}

	if err := st.InsertAuditLog(ctx, uuid.NewString(), uid, action, target, payload); err != nil {
		slog.WarnContext(ctx, "audit_log.write_failed", "action", action, "error", err)
	}
}
