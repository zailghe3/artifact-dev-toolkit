// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import (
	"encoding/json"
	"net/http"
)

type auditLogEntry struct {
	ID        string          `json:"id"`
	Action    string          `json:"action"`
	Target    string          `json:"target"`
	Details   json.RawMessage `json:"details"`
	UserID    string          `json:"user_id"`
	UserName  string          `json:"user_name"`
	UserEmail string          `json:"user_email"`
	CreatedAt string          `json:"created_at"`
}

type auditLogResponse struct {
	Entries []auditLogEntry `json:"entries"`
	Total   int             `json:"total"`
	Page    int             `json:"page"`
	PerPage int             `json:"per_page"`
}

// handleListAuditLog returns the last 90 days of admin actions.
func (s *Server) handleListAuditLog(w http.ResponseWriter, r *http.Request) {
	pg := parsePagination(r)
	rows, total, err := s.store.ListAuditLog(r.Context(), pg.PerPage, pg.Offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	resp := auditLogResponse{
		Entries: make([]auditLogEntry, 0, len(rows)),
		Total:   total,
		Page:    pg.Page,
		PerPage: pg.PerPage,
	}
	for _, row := range rows {
		details := json.RawMessage(row.Details)
		if len(details) == 0 {
			details = json.RawMessage("{}")
		}
		resp.Entries = append(resp.Entries, auditLogEntry{
			ID:        row.ID,
			Action:    row.Action,
			Target:    row.Target,
			Details:   details,
			UserID:    row.UserID,
			UserName:  row.UserName,
			UserEmail: row.UserEmail,
			CreatedAt: row.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		})
	}
	writeJSON(w, http.StatusOK, resp)
}
