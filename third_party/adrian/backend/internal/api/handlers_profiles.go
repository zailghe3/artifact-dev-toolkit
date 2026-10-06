// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/secureagentics/Adrian/backend/internal/store"
)

const (
	maxAgentNameChars = 80
	maxRemitChars     = 500
	maxEntryChars     = 120
	maxEntryCount     = 10
)

type agentProfileRequest struct {
	Name      string   `json:"name"`
	Enabled   bool     `json:"enabled"`
	Remit     string   `json:"remit"`
	M0Entries []string `json:"m0_entries"`
	M3Entries []string `json:"m3_entries"`
}

type agentProfileResponse struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Enabled   bool     `json:"enabled"`
	Remit     string   `json:"remit"`
	M0Entries []string `json:"m0_entries"`
	M3Entries []string `json:"m3_entries"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

func (s *Server) handleListAgentProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := s.store.ListAgentProfiles(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	out := make([]agentProfileResponse, 0, len(profiles))
	for _, p := range profiles {
		out = append(out, profileResponseFromStore(p))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleGetAgentProfile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := s.store.GetAgentProfile(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "agent profile not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	writeJSON(w, http.StatusOK, profileResponseFromStore(p))
}

func (s *Server) handleCreateAgentProfile(w http.ResponseWriter, r *http.Request) {
	var req agentProfileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if err := validateAgentName(req.Name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.M0Entries == nil {
		req.M0Entries = []string{}
	}
	if req.M3Entries == nil {
		req.M3Entries = []string{}
	}
	if err := validateProfileContent(req.Remit, req.M0Entries, req.M3Entries); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	m0JSON, _ := json.Marshal(req.M0Entries)
	m3JSON, _ := json.Marshal(req.M3Entries)

	p := &store.AgentProfile{
		ID:        uuid.NewString(),
		Name:      req.Name,
		Enabled:   req.Enabled,
		Remit:     req.Remit,
		M0Entries: string(m0JSON),
		M3Entries: string(m3JSON),
	}
	if err := s.store.CreateAgentProfile(r.Context(), p); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "agent name already in use")
			return
		}
		writeError(w, http.StatusInternalServerError, "create failed")
		return
	}

	created, _ := s.store.GetAgentProfile(r.Context(), p.ID)

	writeAuditLog(r.Context(), s.store, userID(r), "agent_profile_created", "agent_profiles",
		map[string]any{
			"agent_profile_id": p.ID,
			"name":             p.Name,
			"enabled":          p.Enabled,
			"remit_length":     utf8.RuneCountInString(p.Remit),
			"m0_entry_count":   len(req.M0Entries),
			"m3_entry_count":   len(req.M3Entries),
		})

	writeJSON(w, http.StatusCreated, profileResponseFromStore(created))
}

func (s *Server) handleUpdateAgentProfile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req agentProfileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if err := validateAgentName(req.Name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.M0Entries == nil {
		req.M0Entries = []string{}
	}
	if req.M3Entries == nil {
		req.M3Entries = []string{}
	}
	if err := validateProfileContent(req.Remit, req.M0Entries, req.M3Entries); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	m0JSON, _ := json.Marshal(req.M0Entries)
	m3JSON, _ := json.Marshal(req.M3Entries)

	p := &store.AgentProfile{
		ID:        id,
		Name:      req.Name,
		Enabled:   req.Enabled,
		Remit:     req.Remit,
		M0Entries: string(m0JSON),
		M3Entries: string(m3JSON),
	}
	if err := s.store.UpdateAgentProfile(r.Context(), p); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "agent profile not found")
			return
		}
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "agent name already in use")
			return
		}
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}

	updated, _ := s.store.GetAgentProfile(r.Context(), id)

	writeAuditLog(r.Context(), s.store, userID(r), "agent_profile_updated", "agent_profiles",
		map[string]any{
			"agent_profile_id": id,
			"name":             req.Name,
			"enabled":          req.Enabled,
			"remit_length":     utf8.RuneCountInString(req.Remit),
			"m0_entry_count":   len(req.M0Entries),
			"m3_entry_count":   len(req.M3Entries),
		})

	writeJSON(w, http.StatusOK, profileResponseFromStore(updated))
}

func profileResponseFromStore(p *store.AgentProfile) agentProfileResponse {
	resp := agentProfileResponse{
		ID:        p.ID,
		Name:      p.Name,
		Enabled:   p.Enabled,
		Remit:     p.Remit,
		M0Entries: []string{},
		M3Entries: []string{},
		CreatedAt: p.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: p.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	_ = json.Unmarshal([]byte(p.M0Entries), &resp.M0Entries)
	_ = json.Unmarshal([]byte(p.M3Entries), &resp.M3Entries)
	if resp.M0Entries == nil {
		resp.M0Entries = []string{}
	}
	if resp.M3Entries == nil {
		resp.M3Entries = []string{}
	}
	return resp
}

func validateAgentName(name string) error {
	if name == "" {
		return fmt.Errorf("name required")
	}
	if utf8.RuneCountInString(name) > maxAgentNameChars {
		return fmt.Errorf("name exceeds %d chars", maxAgentNameChars)
	}
	if strings.ContainsAny(name, "<>") {
		return fmt.Errorf("name contains forbidden chars '<' or '>'")
	}
	return nil
}

func validateProfileContent(remit string, m0, m3 []string) error {
	if utf8.RuneCountInString(remit) > maxRemitChars {
		return fmt.Errorf("remit exceeds %d chars", maxRemitChars)
	}
	if strings.ContainsAny(remit, "<>") {
		return fmt.Errorf("remit contains forbidden chars '<' or '>'")
	}
	if err := validateEntryList("m0_entries", m0); err != nil {
		return err
	}
	if err := validateEntryList("m3_entries", m3); err != nil {
		return err
	}
	return nil
}

func validateEntryList(name string, entries []string) error {
	if len(entries) > maxEntryCount {
		return fmt.Errorf("%s exceeds %d entries", name, maxEntryCount)
	}
	for i, e := range entries {
		if utf8.RuneCountInString(e) > maxEntryChars {
			return fmt.Errorf("%s[%d] exceeds %d chars", name, i, maxEntryChars)
		}
		if strings.ContainsAny(e, "<>") {
			return fmt.Errorf("%s[%d] contains forbidden chars '<' or '>'", name, i)
		}
	}
	return nil
}
