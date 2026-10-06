// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package auth

import (
	"errors"
	"strings"
	"testing"
)

// knownGood is a hash produced by Python's stdlib hashlib.pbkdf2_hmac
// with the same parameters scripts/setup.py:hash_password uses:
//
//	salt        = bytes.fromhex("0123456789abcdef0123456789abcdef")
//	iterations  = 600000
//	derived_len = 32
//	plaintext   = b"correct horse battery staple"
//
// Locking this in a test means the Go verifier and the Python hasher
// stay byte-compatible across changes.
const knownGood = "pbkdf2_sha256$600000$0123456789abcdef0123456789abcdef$f4c8b79f689b9ebab130a87da1c14aac06185c317335624641a45dc2cafa754d"

func TestVerifyKnownGood(t *testing.T) {
	if err := Verify("correct horse battery staple", knownGood); err != nil {
		t.Fatalf("Verify(known-good) = %v, want nil", err)
	}
}

func TestVerifyMismatch(t *testing.T) {
	err := Verify("incorrect", knownGood)
	if !errors.Is(err, ErrPasswordMismatch) {
		t.Fatalf("Verify(wrong) = %v, want ErrPasswordMismatch", err)
	}
}

func TestVerifyMalformed(t *testing.T) {
	cases := map[string]string{
		"too few fields":   "pbkdf2_sha256$600000$abcd",
		"wrong algorithm":  "argon2id$3$abcd$ef01",
		"non-numeric iter": "pbkdf2_sha256$abc$0123$abcd",
		"non-hex salt":     "pbkdf2_sha256$600000$zzzz$abcd",
		"non-hex digest":   "pbkdf2_sha256$600000$abcd$zzzz",
	}
	for name, stored := range cases {
		t.Run(name, func(t *testing.T) {
			err := Verify("anything", stored)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if errors.Is(err, ErrPasswordMismatch) {
				t.Fatalf("got ErrPasswordMismatch, want malformed-hash error: %v", err)
			}
			if !strings.Contains(err.Error(), "malformed hash") {
				t.Fatalf("err = %v, want %q in message", err, "malformed hash")
			}
		})
	}
}
