// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// APIKey is a row from api_keys.
type APIKey struct {
	ID             string
	AgentProfileID *string
	Label          *string
}

// APIKeyListRow carries the public-facing key info (no key_hash).
type APIKeyListRow struct {
	ID             string
	Prefix         string
	Label          *string
	AgentProfileID *string
	AgentName      string
	CreatedAt      time.Time
	RevokedAt      *time.Time
}

// APIKeyCreate captures the values for a new INSERT.
type APIKeyCreate struct {
	ID             string
	KeyHash        string
	Prefix         string
	Label          string
	AgentProfileID string
}

// LookupAPIKey returns the matching row by hex-encoded SHA-256 hash.
// Revoked keys (revoked_at IS NOT NULL) return ErrNotFound.
func (s *Store) LookupAPIKey(ctx context.Context, keyHashHex string) (*APIKey, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, agent_profile_id, label
		 FROM api_keys
		 WHERE key_hash = ? AND revoked_at IS NULL
		 LIMIT 1`, keyHashHex)
	var k APIKey
	if err := row.Scan(&k.ID, &k.AgentProfileID, &k.Label); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &k, nil
}

// ListAPIKeys returns all keys (revoked + active) joined with the
// owning agent profile's name. Ordered by created_at DESC.
func (s *Store) ListAPIKeys(ctx context.Context) ([]*APIKeyListRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT k.id, k.prefix, k.label, k.agent_profile_id,
		        COALESCE(ap.name, ''), k.created_at, k.revoked_at
		 FROM api_keys k
		 LEFT JOIN agent_profiles ap ON ap.id = k.agent_profile_id
		 ORDER BY k.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*APIKeyListRow{}
	for rows.Next() {
		var r APIKeyListRow
		var label, agentProfileID, revokedAt sql.NullString
		var createdAt string
		if err := rows.Scan(&r.ID, &r.Prefix, &label, &agentProfileID, &r.AgentName, &createdAt, &revokedAt); err != nil {
			return nil, err
		}
		if label.Valid {
			r.Label = &label.String
		}
		if agentProfileID.Valid {
			r.AgentProfileID = &agentProfileID.String
		}
		r.CreatedAt = parseTime(createdAt)
		if revokedAt.Valid {
			t := parseTime(revokedAt.String)
			r.RevokedAt = &t
		}
		out = append(out, &r)
	}
	return out, rows.Err()
}

// CreateAPIKeyForAgent inserts a new key bound to an agent profile,
// transactionally revoking any prior un-revoked keys for that same
// agent. Returns the IDs of the keys that were revoked so the WS
// connection registry can terminate any open sockets bound to them.
//
// The agent profile is checked for existence inside the same
// transaction; ErrNotFound is returned if no such profile exists.
func (s *Store) CreateAPIKeyForAgent(ctx context.Context, k *APIKeyCreate) (revokedIDs []string, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var profileExists int
	if err := tx.QueryRowContext(ctx,
		`SELECT 1 FROM agent_profiles WHERE id = ?`, k.AgentProfileID,
	).Scan(&profileExists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	rows, err := tx.QueryContext(ctx,
		`UPDATE api_keys
		   SET revoked_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
		 WHERE agent_profile_id = ? AND revoked_at IS NULL
		 RETURNING id`,
		k.AgentProfileID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		revokedIDs = append(revokedIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	var label any
	if k.Label != "" {
		label = k.Label
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO api_keys (id, key_hash, prefix, label, agent_profile_id)
		 VALUES (?, ?, ?, ?, ?)`,
		k.ID, k.KeyHash, k.Prefix, label, k.AgentProfileID); err != nil {
		return nil, err
	}

	return revokedIDs, tx.Commit()
}

// RevokeAPIKey soft-deletes a key by setting revoked_at = now().
// Returns ErrNotFound if no such id exists.
func (s *Store) RevokeAPIKey(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE api_keys
		   SET revoked_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
		 WHERE id = ? AND revoked_at IS NULL`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		// Either the id doesn't exist or it's already revoked. Either
		// way return ErrNotFound; caller surfaces it as 404.
		return ErrNotFound
	}
	return nil
}
