// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// JSON writes a JSON response wrapped in `{"data": ...}` style.
// Status is the HTTP status code; data is marshaled with the standard
// encoder.
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
}

// writeError writes a JSON `{"error": <msg>}` body with the given
// status. Pair with writeJSON so handlers never hand-roll error
// envelopes.
func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// decodeJSON parses the request body into dst. Returns the decode
// error on failure for the caller to surface as 400.
func decodeJSON(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}

// pagination holds parsed page + per_page.
type pagination struct {
	Page    int
	PerPage int
	Offset  int
}

// parsePagination extracts page (default 1) and per_page (default 20,
// max 100) from query params. Out-of-range values silently clamp.
func parsePagination(r *http.Request) pagination {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	return pagination{
		Page:    page,
		PerPage: perPage,
		Offset:  (page - 1) * perPage,
	}
}
