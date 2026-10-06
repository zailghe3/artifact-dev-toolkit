// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// healthz is a liveness probe. Always 200; only confirms the Go
// process is up and the HTTP listener responds. Does not check the
// database or the classifier, use /readyz for those.
func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}

// readyzChecks captures the per-subsystem readiness status emitted in
// the JSON response body. "ok" when reachable; the underlying error
// string when not. Lets the operator (and compose health-check) pin
// down which subsystem is wedged without having to dig through logs.
type readyzChecks struct {
	DB         string `json:"db"`
	Classifier string `json:"classifier"`
}

// readyzResponse is the shape /readyz returns. ok=true with HTTP 200
// when every probe passes; ok=false with HTTP 503 when any probe
// fails. The per-check field carries either "ok" or the error message.
type readyzResponse struct {
	OK     bool         `json:"ok"`
	Checks readyzChecks `json:"checks"`
}

// readyzTimeout is the overall budget for /readyz. The DB ping is
// near-instant locally; the classifier probe is capped separately
// inside engine.Ping. Picked to be slow enough to ride a transient
// network hiccup but fast enough that compose's healthcheck retries
// before the start_period elapses.
const readyzTimeout = 4 * time.Second

// readyz is a readiness probe. Verifies that the backend can actually
// serve classification traffic right now: SQLite is reachable, and
// the configured classifier upstream answers TCP / HTTP. Returns 200
// when everything is green, 503 (with the failing subsystem named)
// otherwise. Compose's backend healthcheck and external orchestrators
// gate on this; /healthz is only the process-up signal.
func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), readyzTimeout)
	defer cancel()

	out := readyzResponse{OK: true, Checks: readyzChecks{DB: "ok", Classifier: "ok"}}

	if err := s.db.PingContext(ctx); err != nil {
		out.OK = false
		out.Checks.DB = err.Error()
	}

	if err := s.engine.Ping(ctx); err != nil {
		out.OK = false
		out.Checks.Classifier = err.Error()
	}

	status := http.StatusOK
	if !out.OK {
		status = http.StatusServiceUnavailable
	}
	// Bypass writeJSON's `{"data": ...}` wrapper: probe endpoints
	// keep their fields at the root so external orchestrators and the
	// compose healthcheck script can read `.ok` / `.checks.db` etc
	// without an indirection layer.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(out)
}
