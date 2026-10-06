// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package engine

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	pb "github.com/secureagentics/Adrian/backend/internal/proto"
)

// DefaultWindowSize is the maximum number of paired events kept per
// (session, invocation, agent_id) tuple.
const DefaultWindowSize = 16

// DefaultWindowTTL is the idle window after which an entry is evicted
// by Sweep. Refreshed on every Push.
const DefaultWindowTTL = 24 * time.Hour

// Key identifies one classify-cycle scope. All three fields must be
// non-empty for a real window write; an event missing any field is
// classified history-less and never touches the window.
type Key struct {
	SessionID    string
	InvocationID string
	AgentID      string
}

// complete reports whether the key carries all three identity fields.
func (k Key) complete() bool {
	return k.SessionID != "" && k.InvocationID != "" && k.AgentID != ""
}

// HistoryItem is one stored turn: the original paired event plus the
// MAD code the classifier returned for it. Empty MADCode means the
// turn was pushed before classification (shouldn't happen via the
// normal classify path, but the few-shot replay tolerates it as M0).
type HistoryItem struct {
	Event   *pb.PairedEvent
	MADCode string
}

// SlidingWindow holds per-key event history plus a per-key mutex
// (the "agent lock") that serialises read-classify-publish-push
// across same-key events. Different keys don't contend.
//
// Single-process, in-memory only. Restart loses warm state, the
// classifier just starts cold for known keys, no correctness impact.
type SlidingWindow struct {
	mu      sync.Mutex
	entries map[Key]*windowEntry
	size    int
	ttl     time.Duration
}

type windowEntry struct {
	mu         sync.Mutex // the per-key agent lock
	items      []HistoryItem
	lastAccess time.Time
	guid       string // lazily generated; per-conversation untrusted-tag id
}

// WindowOpts configures a SlidingWindow. Zero values fall back to the
// Default* constants.
type WindowOpts struct {
	Size int
	TTL  time.Duration
}

// NewSlidingWindow returns a window ready for Acquire. Size and TTL
// default to DefaultWindowSize / DefaultWindowTTL when zero.
func NewSlidingWindow(opts WindowOpts) *SlidingWindow {
	size := opts.Size
	if size <= 0 {
		size = DefaultWindowSize
	}
	ttl := opts.TTL
	if ttl <= 0 {
		ttl = DefaultWindowTTL
	}
	return &SlidingWindow{
		entries: make(map[Key]*windowEntry),
		size:    size,
		ttl:     ttl,
	}
}

// Handle is the per-key locked view returned by Acquire. Caller MUST
// invoke Release exactly once, typically via defer.
type Handle struct {
	w     *SlidingWindow
	entry *windowEntry
}

// Acquire takes the per-key lock and returns a Handle. Concurrent
// Acquires for the same key block; different keys proceed in
// parallel. The entry is created on first sight.
//
// The two-phase lock (w.mu, then e.mu) opens a window where Sweep can
// evict the entry while we wait on e.mu. The post-lock re-check
// re-reads the map under w.mu and retries if our entry was evicted;
// without it two goroutines could end up with handles to different
// entries for the same key, breaking per-key serialisation.
func (w *SlidingWindow) Acquire(k Key) *Handle {
	for {
		w.mu.Lock()
		e, ok := w.entries[k]
		if !ok {
			e = &windowEntry{lastAccess: time.Now()}
			w.entries[k] = e
		}
		w.mu.Unlock()

		e.mu.Lock()

		w.mu.Lock()
		cur, stillInMap := w.entries[k]
		w.mu.Unlock()
		if stillInMap && cur == e {
			return &Handle{w: w, entry: e}
		}
		// Sweep removed our entry between unlock and lock; release the
		// stale entry's mu and retry. Bounded loop: each iteration
		// either wins the race or another goroutine recreates the
		// entry which we'll find on the next pass.
		e.mu.Unlock()
	}
}

// History returns a copy of the entry's stored items, oldest first.
// The slice is owned by the caller; modifying it does not affect the
// window.
func (h *Handle) History() []HistoryItem {
	out := make([]HistoryItem, len(h.entry.items))
	copy(out, h.entry.items)
	return out
}

// Guid returns the per-conversation untrusted-tag id, generating a
// fresh UUID4 on first call. Stable for the lifetime of the entry
// (until Sweep evicts it). The lock is held by the caller, so this
// access is unsynchronised by design.
func (h *Handle) Guid() string {
	if h.entry.guid == "" {
		h.entry.guid = uuid.NewString()
	}
	h.entry.lastAccess = time.Now()
	return h.entry.guid
}

// freshGuid returns a one-shot UUID for classify calls that bypass
// the sliding window (event lacks identity fields, or window is nil
// in tests). The model still sees a wrapped untrusted boundary; only
// the across-call stability is forfeit.
func freshGuid() string {
	return uuid.NewString()
}

// Push appends one item, trims to the configured size, and refreshes
// the entry's lastAccess so Sweep doesn't reap an active conversation.
func (h *Handle) Push(ev *pb.PairedEvent, madCode string) {
	h.entry.items = append(h.entry.items, HistoryItem{Event: ev, MADCode: madCode})
	if over := len(h.entry.items) - h.w.size; over > 0 {
		h.entry.items = h.entry.items[over:]
	}
	h.entry.lastAccess = time.Now()
}

// Release frees the per-key lock. Idempotent calls are NOT supported -
// each Acquire pairs with exactly one Release.
func (h *Handle) Release() {
	h.entry.mu.Unlock()
}

// Sweep evicts entries idle past maxIdle. Runs every `every` until ctx
// is cancelled. Eviction tries the entry's mutex with TryLock, a held
// lock means the entry is in active use, so we skip and revisit on the
// next pass.
func (w *SlidingWindow) Sweep(ctx context.Context, every, maxIdle time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.evictIdle(maxIdle)
		}
	}
}

func (w *SlidingWindow) evictIdle(maxIdle time.Duration) {
	cutoff := time.Now().Add(-maxIdle)

	w.mu.Lock()
	defer w.mu.Unlock()
	for k, e := range w.entries {
		if !e.mu.TryLock() {
			continue // active; skip
		}
		if e.lastAccess.Before(cutoff) {
			delete(w.entries, k)
		}
		e.mu.Unlock()
	}
}

// keyFromEvent builds a Key from a PairedEvent's identity fields.
// Returns an incomplete key when any field is missing; the caller
// checks key.complete() to decide whether to take the windowed path.
func keyFromEvent(ev *pb.PairedEvent) Key {
	if ev == nil {
		return Key{}
	}
	agentID := ""
	if a := ev.GetAgent(); a != nil {
		agentID = a.GetAgentId()
	}
	return Key{
		SessionID:    ev.GetSessionId(),
		InvocationID: ev.GetInvocationId(),
		AgentID:      agentID,
	}
}
