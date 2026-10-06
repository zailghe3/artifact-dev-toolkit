// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

// Package auth verifies passwords stored in the SQLite users table.
//
// The hash format is `pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>`,
// produced by `scripts/setup.py:hash_password`. The format is locked
// here so the bootstrap container and the Go backend stay in sync.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

// ErrPasswordMismatch is returned when the supplied plaintext does not
// hash to the stored value. Distinct from a malformed-hash error so
// callers can surface "wrong password" without leaking storage detail.
var ErrPasswordMismatch = errors.New("password mismatch")

const (
	expectedAlgorithm = "pbkdf2_sha256"
	hashIterations    = 600000 // matches scripts/setup.py:PBKDF2_ITERATIONS
	hashSaltBytes     = 16
	hashKeyLen        = 32
)

// Verify checks plaintext against the stored hash. Returns nil on
// match, ErrPasswordMismatch on a clean mismatch, or a wrapped error
// if the stored hash is malformed.
func Verify(plaintext, stored string) error {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 {
		return fmt.Errorf("malformed hash: want 4 fields, got %d", len(parts))
	}
	if parts[0] != expectedAlgorithm {
		return fmt.Errorf("malformed hash: algorithm %q (want %q)", parts[0], expectedAlgorithm)
	}

	iterations, err := strconv.Atoi(parts[1])
	if err != nil {
		return fmt.Errorf("malformed hash: iterations: %w", err)
	}
	if iterations < 1 {
		return fmt.Errorf("malformed hash: iterations must be >= 1, got %d", iterations)
	}

	salt, err := hex.DecodeString(parts[2])
	if err != nil {
		return fmt.Errorf("malformed hash: salt hex: %w", err)
	}
	expected, err := hex.DecodeString(parts[3])
	if err != nil {
		return fmt.Errorf("malformed hash: digest hex: %w", err)
	}

	derived := pbkdf2.Key([]byte(plaintext), salt, iterations, len(expected), sha256.New)
	if subtle.ConstantTimeCompare(derived, expected) != 1 {
		return ErrPasswordMismatch
	}
	return nil
}

// Hash produces a `pbkdf2_sha256$<iter>$<salt_hex>$<hash_hex>` string
// using the same parameters scripts/setup.py:hash_password uses, so
// passwords created here are interchangeable with those created at
// bootstrap time.
func Hash(plaintext string) (string, error) {
	salt := make([]byte, hashSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	derived := pbkdf2.Key([]byte(plaintext), salt, hashIterations, hashKeyLen, sha256.New)
	return fmt.Sprintf("%s$%d$%s$%s",
		expectedAlgorithm, hashIterations, hex.EncodeToString(salt), hex.EncodeToString(derived),
	), nil
}
