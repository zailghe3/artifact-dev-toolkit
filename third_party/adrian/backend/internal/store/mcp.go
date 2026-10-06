// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package store

import (
	"context"
	"time"
)

// McpServer is one row in the mcp_servers table.
type McpServer struct {
	SessionID string
	Name      string
	Transport string
	Endpoint  string
}

// McpServerListRow is the read shape with the received_at column.
type McpServerListRow struct {
	SessionID  string
	Name       string
	Transport  string
	Endpoint   string
	ReceivedAt time.Time
}

// ReplaceMcpServersForSession deletes any existing rows for this
// session_id and inserts the supplied set. Mirrors the SDK's
// "one-shot inventory" semantics: every McpInventory frame replaces
// the prior view.
func (s *Store) ReplaceMcpServersForSession(ctx context.Context, sessionID string, servers []McpServer) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM mcp_servers WHERE session_id = ?`, sessionID); err != nil {
		return err
	}

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO mcp_servers (session_id, name, transport, endpoint) VALUES (?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, srv := range servers {
		if _, err := stmt.ExecContext(ctx, sessionID, srv.Name, srv.Transport, srv.Endpoint); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListMcpServers returns one row per (session_id, name) pair as
// reported by the SDK at McpInventory time. Newest reports first so a
// fresh SDK connection surfaces immediately.
func (s *Store) ListMcpServers(ctx context.Context) ([]*McpServerListRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT session_id, name, transport, endpoint, received_at
		 FROM mcp_servers
		 ORDER BY received_at DESC, session_id, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*McpServerListRow{}
	for rows.Next() {
		r := &McpServerListRow{}
		var receivedAt string
		if err := rows.Scan(&r.SessionID, &r.Name, &r.Transport, &r.Endpoint, &receivedAt); err != nil {
			return nil, err
		}
		r.ReceivedAt = parseTime(receivedAt)
		out = append(out, r)
	}
	return out, rows.Err()
}
