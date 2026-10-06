// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import (
	"net/http"

	"github.com/secureagentics/Adrian/backend/internal/alerts"
)

// handleGetMadAlerts returns the curated alert bundle the dashboard
// uses to render verdict explanations in place of the model's raw
// reasoning. Bundle is immutable per build; the dashboard caches it
// after the first fetch.
func (s *Server) handleGetMadAlerts(w http.ResponseWriter, r *http.Request) {
	b, err := alerts.Get()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "alerts bundle unavailable")
		return
	}
	writeJSON(w, http.StatusOK, b)
}
