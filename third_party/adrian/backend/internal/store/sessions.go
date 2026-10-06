// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Session is one row from user_sessions.
type Session struct {
	ID        string
	UserID    string
	ExpiresAt time.Time
}

// CreateSession inserts a new session token. Caller generates the
// token; expiresAt is absolute.
func (s *Store) CreateSession(ctx context.Context, token, userID string, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)`,
		token, userID, expiresAt.UTC().Format(time.RFC3339Nano))
	return err
}

// LookupSession returns the row if it exists and has not expired.
// Returns ErrNotFound if no match or expired.
func (s *Store) LookupSession(ctx context.Context, token string) (*Session, error) {
	var sess Session
	var expiresAt string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, user_id, expires_at FROM user_sessions WHERE id = ?`,
		token,
	).Scan(&sess.ID, &sess.UserID, &expiresAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	t, err := time.Parse(time.RFC3339Nano, expiresAt)
	if err != nil {
		// Fall back to the simpler form setup.py and the db PRAGMA write.
		t, err = time.Parse(time.RFC3339, expiresAt)
		if err != nil {
			return nil, err
		}
	}
	if time.Now().UTC().After(t) {
		return nil, ErrNotFound
	}
	sess.ExpiresAt = t
	return &sess, nil
}

// DeleteSession removes a single session by token.
func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM user_sessions WHERE id = ?`, token)
	return err
}

// DeleteSessionsForUser removes every session for a user, optionally
// keeping one (the caller's current session) by passing its token as
// `except`. Pass "" to delete all.
func (s *Store) DeleteSessionsForUser(ctx context.Context, userID, except string) error {
	if except == "" {
		_, err := s.db.ExecContext(ctx,
			`DELETE FROM user_sessions WHERE user_id = ?`, userID)
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM user_sessions WHERE user_id = ? AND id != ?`, userID, except)
	return err
}
