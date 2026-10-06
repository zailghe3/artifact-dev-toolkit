// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// AgentProfile is the dashboard-facing shape. m0/m3 entries are
// JSON-encoded TEXT in the column; callers Marshal/Unmarshal.
type AgentProfile struct {
	ID        string
	Name      string
	Enabled   bool
	Remit     string
	M0Entries string // raw JSON text
	M3Entries string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// ErrConflict is returned by CreateAgentProfile when the unique name
// constraint is violated.
var ErrConflict = errors.New("conflict")

// ListAgentProfiles returns all rows ordered by created_at ASC.
func (s *Store) ListAgentProfiles(ctx context.Context) ([]*AgentProfile, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, enabled, remit, m0_entries, m3_entries, created_at, updated_at
		 FROM agent_profiles ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*AgentProfile{}
	for rows.Next() {
		p, err := scanAgentProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetAgentProfile returns one row by id or ErrNotFound.
func (s *Store) GetAgentProfile(ctx context.Context, id string) (*AgentProfile, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, name, enabled, remit, m0_entries, m3_entries, created_at, updated_at
		 FROM agent_profiles WHERE id = ?`, id)
	return scanAgentProfileRow(row)
}

// CreateAgentProfile inserts a new row. Returns ErrConflict if the
// name is already taken.
func (s *Store) CreateAgentProfile(ctx context.Context, p *AgentProfile) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO agent_profiles (id, name, enabled, remit, m0_entries, m3_entries)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		p.ID, p.Name, boolToInt(p.Enabled), p.Remit, p.M0Entries, p.M3Entries)
	if err != nil {
		if isUniqueConstraintErr(err) {
			return ErrConflict
		}
		return err
	}
	return nil
}

// UpdateAgentProfile rewrites every editable field. Returns
// ErrNotFound if no row matched, ErrConflict on name collision.
func (s *Store) UpdateAgentProfile(ctx context.Context, p *AgentProfile) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE agent_profiles
		 SET name = ?, enabled = ?, remit = ?, m0_entries = ?, m3_entries = ?,
		     updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
		 WHERE id = ?`,
		p.Name, boolToInt(p.Enabled), p.Remit, p.M0Entries, p.M3Entries, p.ID)
	if err != nil {
		if isUniqueConstraintErr(err) {
			return ErrConflict
		}
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func isUniqueConstraintErr(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") ||
		strings.Contains(msg, "constraint failed: agent_profiles.name")
}

func scanAgentProfile(rows *sql.Rows) (*AgentProfile, error) {
	var p AgentProfile
	var enabled int
	var createdAt, updatedAt string
	if err := rows.Scan(&p.ID, &p.Name, &enabled, &p.Remit, &p.M0Entries, &p.M3Entries, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	p.Enabled = enabled == 1
	p.CreatedAt = parseTime(createdAt)
	p.UpdatedAt = parseTime(updatedAt)
	return &p, nil
}

func scanAgentProfileRow(row *sql.Row) (*AgentProfile, error) {
	var p AgentProfile
	var enabled int
	var createdAt, updatedAt string
	if err := row.Scan(&p.ID, &p.Name, &enabled, &p.Remit, &p.M0Entries, &p.M3Entries, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	p.Enabled = enabled == 1
	p.CreatedAt = parseTime(createdAt)
	p.UpdatedAt = parseTime(updatedAt)
	return &p, nil
}

func parseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t, _ = time.Parse(time.RFC3339, s)
	}
	return t
}
