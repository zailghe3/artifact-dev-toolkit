// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package store

import (
	"context"
	"database/sql"
	"time"
)

// InsertAuditLog persists one audit row. Best-effort: callers log a
// warn on error and never let an audit failure bubble up to break the
// underlying action.
func (s *Store) InsertAuditLog(ctx context.Context, id string, userID sql.NullString, action, target, detailsJSON string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO audit_log (id, user_id, action, target, details)
		 VALUES (?, ?, ?, NULLIF(?, ''), ?)`,
		id, userID, action, target, detailsJSON)
	return err
}

// AuditLogRow is the read shape, with the user JOIN populated when the
// row's user_id is set (system actions leave it blank).
type AuditLogRow struct {
	ID        string
	UserID    string
	UserName  string
	UserEmail string
	Action    string
	Target    string
	Details   string
	CreatedAt time.Time
}

// ListAuditLog returns paginated audit rows from the last 90 days,
// newest first, with the user JOIN. Retention is read-side only, no
// purge job runs; older rows simply stop being visible.
func (s *Store) ListAuditLog(ctx context.Context, perPage, offset int) ([]*AuditLogRow, int, error) {
	const window = "-90 days"

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM audit_log WHERE created_at >= datetime('now', ?)`,
		window,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT al.id, COALESCE(al.user_id, ''), COALESCE(u.name, ''), COALESCE(u.email, ''),
		        al.action, COALESCE(al.target, ''), al.details, al.created_at
		 FROM audit_log al
		 LEFT JOIN users u ON u.id = al.user_id
		 WHERE al.created_at >= datetime('now', ?)
		 ORDER BY al.created_at DESC
		 LIMIT ? OFFSET ?`,
		window, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := []*AuditLogRow{}
	for rows.Next() {
		r := &AuditLogRow{}
		var createdAt string
		if err := rows.Scan(&r.ID, &r.UserID, &r.UserName, &r.UserEmail,
			&r.Action, &r.Target, &r.Details, &createdAt); err != nil {
			return nil, 0, err
		}
		r.CreatedAt = parseTime(createdAt)
		out = append(out, r)
	}
	return out, total, rows.Err()
}
