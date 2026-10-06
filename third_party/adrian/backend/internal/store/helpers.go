// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package store

// boolPtrToInt converts a *bool to the SQL-friendly form used in
// COALESCE-style partial UPDATE statements: nil -> nil (the column
// stays unchanged); &true -> 1; &false -> 0.
func boolPtrToInt(b *bool) any {
	if b == nil {
		return nil
	}
	if *b {
		return 1
	}
	return 0
}
