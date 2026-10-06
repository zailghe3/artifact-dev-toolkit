// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package ws

import (
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// closeKeyRevoked is the WebSocket close code we send when the REST
// keys handler revokes / rotates a key while the SDK still has the
// socket open. 4xxx is the application-defined range; the leading 4
// rhymes with HTTP 401 so log readers know what happened. The SDK's
// next reconnect attempt will hit AuthMiddleware on the now-revoked
// key and get a 401 there.
const closeKeyRevoked = 4401

// kickWriteDeadline caps how long the kicker waits to write the close
// frame. The point is to terminate fast; if the peer is wedged on read
// and won't drain the close frame within this window, fall through to
// the raw socket close.
const kickWriteDeadline = 2 * time.Second

// ConnRegistry tracks live WebSocket connections per api_key_id so
// the REST keys handler can terminate every connection bound to a
// key immediately on revoke / rotate. Without this, a revoked or
// rotated-out key keeps working until its socket disconnects on its
// own, a leaked key has indefinite read access until the agent
// restarts.
//
// Process-local; OSS deploys are single-process so no Redis fan-out
// is needed. Multi-instance deploys would route the kick over a
// pub/sub channel keyed on api_key_id.
type ConnRegistry struct {
	mu    sync.Mutex
	conns map[string]map[*websocket.Conn]struct{}
}

// NewConnRegistry returns an empty registry.
func NewConnRegistry() *ConnRegistry {
	return &ConnRegistry{conns: make(map[string]map[*websocket.Conn]struct{})}
}

// Register adds conn to the set for apiKeyID and returns a deregister
// callback that the WS handler defers. Multiple connections per key
// are allowed (concurrent agents sharing one key).
func (r *ConnRegistry) Register(apiKeyID string, conn *websocket.Conn) func() {
	r.mu.Lock()
	set, ok := r.conns[apiKeyID]
	if !ok {
		set = map[*websocket.Conn]struct{}{}
		r.conns[apiKeyID] = set
	}
	set[conn] = struct{}{}
	r.mu.Unlock()
	return func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if set, ok := r.conns[apiKeyID]; ok {
			delete(set, conn)
			if len(set) == 0 {
				delete(r.conns, apiKeyID)
			}
		}
	}
}

// KickByKey closes every connection registered under apiKeyID. Sends
// a CloseMessage with code closeKeyRevoked, then closes the socket;
// uses WriteControl which is the gorilla/websocket-blessed primitive
// for a write from a goroutine that is not the connection's normal
// writer. Returns the number of connections terminated. Idempotent:
// kicking a key with no live connections returns 0.
func (r *ConnRegistry) KickByKey(apiKeyID string) int {
	r.mu.Lock()
	set := r.conns[apiKeyID]
	conns := make([]*websocket.Conn, 0, len(set))
	for c := range set {
		conns = append(conns, c)
	}
	delete(r.conns, apiKeyID)
	r.mu.Unlock()
	for _, c := range conns {
		closeMsg := websocket.FormatCloseMessage(closeKeyRevoked, "api key revoked")
		if err := c.WriteControl(websocket.CloseMessage, closeMsg, time.Now().Add(kickWriteDeadline)); err != nil {
			slog.Warn("ws.kick_close_frame_failed",
				"api_key_id", apiKeyID, "error", err)
		}
		if err := c.Close(); err != nil {
			slog.Warn("ws.kick_socket_close_failed",
				"api_key_id", apiKeyID, "error", err)
		}
	}
	if len(conns) > 0 {
		slog.Info("ws.api_key_kicked",
			"api_key_id", apiKeyID, "connections", len(conns))
	}
	return len(conns)
}
