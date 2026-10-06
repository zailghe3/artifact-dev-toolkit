// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

// Package api wires the HTTP router for the Adrian backend.
package api

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/secureagentics/Adrian/backend/internal/config"
	"github.com/secureagentics/Adrian/backend/internal/engine"
	pb "github.com/secureagentics/Adrian/backend/internal/proto"
	"github.com/secureagentics/Adrian/backend/internal/store"
	"github.com/secureagentics/Adrian/backend/internal/ws"
)

type Server struct {
	cfg         *config.Config
	db          *sql.DB
	store       *store.Store
	engine      engine.Classifier
	hub         *ws.Hub
	registry    *ws.ConnRegistry
	verdictHook ws.VerdictHook
	router      *chi.Mux
}

// NewServer returns an http.Handler with all Adrian routes registered.
//
// hub is the per-process pub/sub the WS handler uses for server-pushed
// frames; the REST review handler publishes HITL resolutions through
// the same hub. Required.
//
// registry tracks live WS connections per api_key_id so the keys
// handlers can terminate them on revoke / rotate. Required.
//
// hook fires per classified verdict; pass nil when no observer (tests,
// or builds with notifications disabled).
func NewServer(cfg *config.Config, db *sql.DB, st *store.Store, eng engine.Classifier, hub *ws.Hub, registry *ws.ConnRegistry, hook ws.VerdictHook) *Server {
	s := &Server{
		cfg:         cfg,
		db:          db,
		store:       st,
		engine:      eng,
		hub:         hub,
		registry:    registry,
		verdictHook: hook,
		router:      chi.NewRouter(),
	}
	s.routes()
	return s
}

// publishHitlFrame is a thin shim over Hub.Publish so handlers don't
// need to import the ws package directly.
func (s *Server) publishHitlFrame(sessionID string, frame *pb.ServerFrame) bool {
	return s.hub.Publish(sessionID, frame)
}

// policySnapshotProto wraps ws.PolicySnapshot so review handlers don't
// take a direct package dep.
func (s *Server) policySnapshotProto(p *store.Policy) *pb.PolicySnapshot {
	return ws.PolicySnapshot(p)
}

// ServeHTTP makes Server an http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}

func (s *Server) routes() {
	r := s.router
	r.Use(requestLogger)

	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)

	// WebSocket: SDK <-> backend protocol channel. AuthMiddleware
	// validates `Authorization: Bearer <key>` against api_keys before
	// the upgrade; the handler then runs the binary protocol.
	r.With(ws.AuthMiddleware(s.store)).Get("/ws", ws.NewHandler(s.store, s.engine, s.hub, s.registry, s.verdictHook))

	r.Route("/api", func(api chi.Router) {
		// Public (no session)
		api.Post("/auth/login", s.handleLogin)

		// Protected (session cookie)
		api.Group(func(p chi.Router) {
			p.Use(RequireSession(s.store))

			p.Post("/auth/logout", s.handleLogout)
			p.Post("/auth/change-password", s.handleChangePassword)
			p.Get("/auth/me", s.handleMe)

			p.Get("/settings/policy", s.handleGetPolicy)
			p.Put("/settings/policy", s.handleUpdatePolicy)

			p.Get("/agent-profiles", s.handleListAgentProfiles)
			p.Post("/agent-profiles", s.handleCreateAgentProfile)
			p.Get("/agent-profiles/{id}", s.handleGetAgentProfile)
			p.Put("/agent-profiles/{id}", s.handleUpdateAgentProfile)
			p.Post("/agent-profiles/{id}/keys", s.handleCreateKeyForAgent)

			p.Get("/keys", s.handleListKeys)
			p.Delete("/keys/{id}", s.handleRevokeKey)

			p.Get("/events", s.handleListEvents)
			p.Get("/events/{id}", s.handleGetEvent)
			p.Get("/verdicts", s.handleListVerdicts)
			p.Get("/sessions/{session_id}/timeline", s.handleSessionTimeline)

			p.Get("/mcp/servers", s.handleListMcpServers)

			p.Get("/agents", s.handleListAgents)
			p.Get("/agents/{agent_id}", s.handleGetAgent)

			p.Get("/stats/overview", s.handleStatsOverview)
			p.Get("/stats/activity", s.handleStatsActivity)

			p.Get("/mad-alerts", s.handleGetMadAlerts)

			p.Get("/webhooks", s.handleListWebhooks)
			p.Post("/webhooks", s.handleCreateWebhook)
			p.Delete("/webhooks/{id}", s.handleDeleteWebhook)

			p.Get("/audit-log", s.handleListAuditLog)

			p.Get("/reviews", s.handleListReviews)
			p.Get("/reviews/{id}", s.handleGetReview)
			p.Post("/reviews/{id}/approve", s.handleApproveReview)
			p.Post("/reviews/{id}/reject", s.handleRejectReview)
		})
	})
}
