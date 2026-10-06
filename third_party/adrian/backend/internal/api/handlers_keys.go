// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/secureagentics/Adrian/backend/internal/store"
)

type keyCreateRequest struct {
	Label string `json:"label"`
}

type keyCreateResponse struct {
	ID              string `json:"id"`
	APIKey          string `json:"api_key"` // plaintext, returned ONCE
	Prefix          string `json:"prefix"`
	Label           string `json:"label"`
	AgentProfileID  string `json:"agent_profile_id"`
	AgentName       string `json:"agent_name"`
	RevokedPrevious int    `json:"revoked_previous"`
}

type keyListEntry struct {
	ID             string  `json:"id"`
	Prefix         string  `json:"prefix"`
	Label          string  `json:"label"`
	AgentProfileID *string `json:"agent_profile_id"`
	AgentName      string  `json:"agent_name"`
	CreatedAt      string  `json:"created_at"`
	RevokedAt      *string `json:"revoked_at,omitempty"`
	Revoked        bool    `json:"revoked"`
}

func (s *Server) handleCreateKeyForAgent(w http.ResponseWriter, r *http.Request) {
	agentProfileID := chi.URLParam(r, "id")

	var req keyCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	profile, err := s.store.GetAgentProfile(r.Context(), agentProfileID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "agent profile not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}

	rawKey, keyHash, prefix := generateAPIKey()
	keyID := uuid.NewString()

	revokedIDs, err := s.store.CreateAPIKeyForAgent(r.Context(), &store.APIKeyCreate{
		ID:             keyID,
		KeyHash:        keyHash,
		Prefix:         prefix,
		Label:          req.Label,
		AgentProfileID: agentProfileID,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "agent profile not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	// Terminate any WS connection still authenticated with one of the
	// rotated-out keys. Without this, a leaked old key keeps working
	// until the agent restarts; the revoked_at column would say it's
	// dead but the socket would still drain events.
	if s.registry != nil {
		for _, id := range revokedIDs {
			s.registry.KickByKey(id)
		}
	}

	writeAuditLog(r.Context(), s.store, userID(r), "api_key_created", "api_keys",
		map[string]any{
			"key_id":           keyID,
			"agent_profile_id": agentProfileID,
			"agent_name":       profile.Name,
			"label":            req.Label,
			"revoked_previous": len(revokedIDs),
		})

	writeJSON(w, http.StatusCreated, keyCreateResponse{
		ID:              keyID,
		APIKey:          rawKey,
		Prefix:          prefix,
		Label:           req.Label,
		AgentProfileID:  agentProfileID,
		AgentName:       profile.Name,
		RevokedPrevious: len(revokedIDs),
	})
}

func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := s.store.ListAPIKeys(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	out := make([]keyListEntry, 0, len(keys))
	for _, k := range keys {
		entry := keyListEntry{
			ID:             k.ID,
			Prefix:         k.Prefix,
			AgentProfileID: k.AgentProfileID,
			AgentName:      k.AgentName,
			CreatedAt:      k.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
			Revoked:        k.RevokedAt != nil,
		}
		if k.Label != nil {
			entry.Label = *k.Label
		}
		if k.RevokedAt != nil {
			t := k.RevokedAt.UTC().Format("2006-01-02T15:04:05.000Z")
			entry.RevokedAt = &t
		}
		out = append(out, entry)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleRevokeKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.RevokeAPIKey(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "api key not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "revoke failed")
		return
	}
	// Kick any open WS still authenticated with this key. The DB row
	// is now revoked_at-stamped; we have to hang up the socket too.
	if s.registry != nil {
		s.registry.KickByKey(id)
	}
	writeAuditLog(r.Context(), s.store, userID(r), "api_key_revoked", "api_keys",
		map[string]any{"key_id": id})
	w.WriteHeader(http.StatusNoContent)
}

// generateAPIKey produces a fresh `adr_local_<32 hex>` token, its
// SHA-256 hash, and the first-12-char prefix used for dashboard
// display.
func generateAPIKey() (raw, hash, prefix string) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	raw = fmt.Sprintf("adr_local_%s", hex.EncodeToString(b))
	h := sha256.Sum256([]byte(raw))
	hash = hex.EncodeToString(h[:])
	prefix = raw[:12]
	return
}
