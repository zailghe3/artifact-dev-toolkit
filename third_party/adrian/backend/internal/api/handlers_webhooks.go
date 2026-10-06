// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/secureagentics/Adrian/backend/internal/notifications"
	"github.com/secureagentics/Adrian/backend/internal/store"
)

type webhookEntry struct {
	ID               string `json:"id"`
	Platform         string `json:"platform"`
	WebhookURLMasked string `json:"webhook_url_masked"`
	AlertType        string `json:"alert_type"`
	Enabled          bool   `json:"enabled"`
	CreatedAt        string `json:"created_at"`
}

type webhookListResponse struct {
	Webhooks []webhookEntry `json:"webhooks"`
}

type createWebhookRequest struct {
	WebhookURL string `json:"webhook_url"`
	AlertType  string `json:"alert_type"`
}

type createWebhookResponse struct {
	ID        string `json:"id"`
	AlertType string `json:"alert_type"`
}

func (s *Server) handleListWebhooks(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListWebhooks(r.Context(), false)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	resp := webhookListResponse{Webhooks: make([]webhookEntry, 0, len(rows))}
	for _, row := range rows {
		resp.Webhooks = append(resp.Webhooks, webhookEntry{
			ID:               row.ID,
			Platform:         row.Platform,
			WebhookURLMasked: store.MaskedURL(row.WebhookURL),
			AlertType:        row.AlertType,
			Enabled:          row.Enabled,
			CreatedAt:        row.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleCreateWebhook(w http.ResponseWriter, r *http.Request) {
	var req createWebhookRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := notifications.ValidateDiscordWebhookURL(req.WebhookURL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	switch req.AlertType {
	case "M3", "M4", "all":
	default:
		writeError(w, http.StatusBadRequest, "alert_type must be one of: M3, M4, all")
		return
	}

	id := uuid.NewString()
	if err := s.store.CreateWebhook(r.Context(), id, req.WebhookURL, req.AlertType, userID(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	writeAuditLog(r.Context(), s.store, userID(r), "webhook_created", "webhooks",
		map[string]any{"id": id, "alert_type": req.AlertType})

	writeJSON(w, http.StatusCreated, createWebhookResponse{
		ID:        id,
		AlertType: req.AlertType,
	})
}

func (s *Server) handleDeleteWebhook(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteWebhook(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "webhook not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeAuditLog(r.Context(), s.store, userID(r), "webhook_deleted", "webhooks",
		map[string]any{"id": id})
	w.WriteHeader(http.StatusNoContent)
}
