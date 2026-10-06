// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package store

import (
	"context"
	"database/sql"
	"errors"
)

// User is the row shape returned by user lookups.
type User struct {
	ID                 string
	Email              string
	Name               string
	Role               string
	PasswordHash       string
	MustChangePassword bool
}

// LookupUserByEmail returns the user with the given email or
// ErrNotFound if no row matches.
func (s *Store) LookupUserByEmail(ctx context.Context, email string) (*User, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, email, name, role, password_hash, must_change_password
		 FROM users WHERE email = ?`, email)
	return scanUser(row)
}

// LookupUserByID returns the user with the given id or ErrNotFound.
func (s *Store) LookupUserByID(ctx context.Context, id string) (*User, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, email, name, role, password_hash, must_change_password
		 FROM users WHERE id = ?`, id)
	return scanUser(row)
}

// UpdatePassword sets a new password hash and clears the
// must_change_password flag in one statement.
func (s *Store) UpdatePassword(ctx context.Context, userID, newHash string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
		newHash, userID)
	return err
}

func scanUser(row *sql.Row) (*User, error) {
	var u User
	var must int
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.PasswordHash, &must); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	u.MustChangePassword = must == 1
	return &u, nil
}
