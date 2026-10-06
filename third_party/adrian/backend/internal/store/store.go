// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

// Package store contains all SQL access for the backend. Each
// resource (policies, api_keys, events, verdicts, mcp_servers) gets
// its own file with typed methods on *Store.
//
// The handler packages (api, ws) depend on store, never on *sql.DB
// directly. This keeps SQL out of the request-handling code and gives
// us one place to put per-query observability later.
package store

import (
	"database/sql"
	"errors"
)

// ErrNotFound is returned by lookup methods when no row matches.
var ErrNotFound = errors.New("not found")

type Store struct {
	db *sql.DB
}

func New(db *sql.DB) *Store {
	return &Store{db: db}
}
