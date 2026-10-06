// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package api

import "net/http"

type mcpServerEntry struct {
	SessionID  string `json:"session_id"`
	Name       string `json:"name"`
	Transport  string `json:"transport"`
	Endpoint   string `json:"endpoint"`
	ReceivedAt string `json:"received_at"`
}

type mcpServerListResponse struct {
	Servers []mcpServerEntry `json:"servers"`
}

// handleListMcpServers returns one entry per (session_id, name) pair
// the SDK has reported via McpInventory frames.
func (s *Server) handleListMcpServers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListMcpServers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	resp := mcpServerListResponse{Servers: make([]mcpServerEntry, 0, len(rows))}
	for _, row := range rows {
		resp.Servers = append(resp.Servers, mcpServerEntry{
			SessionID:  row.SessionID,
			Name:       row.Name,
			Transport:  row.Transport,
			Endpoint:   row.Endpoint,
			ReceivedAt: row.ReceivedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		})
	}
	writeJSON(w, http.StatusOK, resp)
}
