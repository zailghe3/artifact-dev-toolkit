// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package engine

import (
	"sync"
	"testing"
	"time"

	pb "github.com/secureagentics/Adrian/backend/internal/proto"
)

func TestPushAndHistoryTrim(t *testing.T) {
	w := NewSlidingWindow(WindowOpts{Size: 4, TTL: time.Hour})
	k := Key{SessionID: "s", InvocationID: "i", AgentID: "a"}
	h := w.Acquire(k)
	defer h.Release()

	for i := 0; i < 6; i++ {
		h.Push(&pb.PairedEvent{EventId: "ev"}, "M0")
	}
	if got := len(h.History()); got != 4 {
		t.Errorf("history len = %d, want 4 (trimmed to size)", got)
	}
}

func TestHistoryReturnsCopy(t *testing.T) {
	w := NewSlidingWindow(WindowOpts{Size: 4, TTL: time.Hour})
	k := Key{SessionID: "s", InvocationID: "i", AgentID: "a"}
	h := w.Acquire(k)
	defer h.Release()

	h.Push(&pb.PairedEvent{EventId: "ev"}, "M0")
	got := h.History()
	got[0].MADCode = "tampered"
	if h.History()[0].MADCode != "M0" {
		t.Error("History() must return a copy; outside mutation leaked back into the window")
	}
}

func TestAcquireSerialisesSameKey(t *testing.T) {
	w := NewSlidingWindow(WindowOpts{Size: 4, TTL: time.Hour})
	k := Key{SessionID: "s", InvocationID: "i", AgentID: "a"}

	gotSecond := make(chan struct{})
	releaseFirst := make(chan struct{})

	first := w.Acquire(k)
	go func() {
		// This blocks until we release `first`.
		second := w.Acquire(k)
		defer second.Release()
		close(gotSecond)
	}()

	select {
	case <-gotSecond:
		t.Fatal("second Acquire should have blocked while first holds the lock")
	case <-time.After(50 * time.Millisecond):
		// Good: still blocked.
	}

	go func() {
		<-releaseFirst
	}()
	first.Release()
	close(releaseFirst)

	select {
	case <-gotSecond:
		// Good: second acquired after release.
	case <-time.After(time.Second):
		t.Fatal("second Acquire never resumed after release")
	}
}

func TestAcquireDifferentKeysParallel(t *testing.T) {
	w := NewSlidingWindow(WindowOpts{Size: 4, TTL: time.Hour})
	a := Key{SessionID: "s1", InvocationID: "i", AgentID: "a"}
	b := Key{SessionID: "s2", InvocationID: "i", AgentID: "a"}

	hA := w.Acquire(a)
	defer hA.Release()

	done := make(chan struct{})
	go func() {
		hB := w.Acquire(b)
		hB.Release()
		close(done)
	}()

	select {
	case <-done:
		// Good: different keys do not contend.
	case <-time.After(200 * time.Millisecond):
		t.Fatal("different-key Acquire blocked; should have proceeded")
	}
}

func TestSweepEvictsCold(t *testing.T) {
	w := NewSlidingWindow(WindowOpts{Size: 4, TTL: time.Hour})
	k := Key{SessionID: "s", InvocationID: "i", AgentID: "a"}

	h := w.Acquire(k)
	h.Push(&pb.PairedEvent{EventId: "ev"}, "M0")
	// Backdate the entry so a sweep with maxIdle=1ms reaps it.
	w.entries[k].lastAccess = time.Now().Add(-time.Hour)
	h.Release()

	w.evictIdle(time.Millisecond)

	w.mu.Lock()
	_, exists := w.entries[k]
	w.mu.Unlock()
	if exists {
		t.Error("evictIdle did not remove the cold entry")
	}
}

func TestSweepSkipsHeldEntries(t *testing.T) {
	w := NewSlidingWindow(WindowOpts{Size: 4, TTL: time.Hour})
	k := Key{SessionID: "s", InvocationID: "i", AgentID: "a"}

	h := w.Acquire(k)
	w.entries[k].lastAccess = time.Now().Add(-time.Hour)

	// Run the sweep concurrently with the lock held; it must skip
	// the entry rather than block or evict.
	var swept sync.WaitGroup
	swept.Add(1)
	go func() {
		defer swept.Done()
		w.evictIdle(time.Millisecond)
	}()
	swept.Wait()

	w.mu.Lock()
	_, exists := w.entries[k]
	w.mu.Unlock()
	if !exists {
		t.Error("evictIdle removed an entry whose lock was held")
	}
	h.Release()
}

func TestKeyIncomplete(t *testing.T) {
	cases := []struct {
		k    Key
		full bool
	}{
		{Key{"s", "i", "a"}, true},
		{Key{"", "i", "a"}, false},
		{Key{"s", "", "a"}, false},
		{Key{"s", "i", ""}, false},
	}
	for _, c := range cases {
		if got := c.k.complete(); got != c.full {
			t.Errorf("Key%v.complete() = %v, want %v", c.k, got, c.full)
		}
	}
}

func TestGuidStableAcrossAcquires(t *testing.T) {
	w := NewSlidingWindow(WindowOpts{Size: 4, TTL: time.Hour})
	k := Key{SessionID: "s", InvocationID: "i", AgentID: "a"}

	h1 := w.Acquire(k)
	g1 := h1.Guid()
	h1.Release()

	h2 := w.Acquire(k)
	g2 := h2.Guid()
	h2.Release()

	if g1 == "" {
		t.Fatal("Guid() returned empty on first call")
	}
	if g1 != g2 {
		t.Errorf("Guid() should be stable across re-acquire; got %q then %q", g1, g2)
	}
}

// TestAcquireAfterEvictionGetsFreshEntry simulates Sweep deleting an
// entry between Acquire's two lock steps. Direct manipulation of
// w.entries forces the post-lock re-check path so we verify the loop
// retries cleanly and yields a usable Handle.
func TestAcquireAfterEvictionGetsFreshEntry(t *testing.T) {
	w := NewSlidingWindow(WindowOpts{Size: 4, TTL: time.Hour})
	k := Key{SessionID: "s", InvocationID: "i", AgentID: "a"}

	// Seed an entry, then evict it from the map directly. A
	// concurrent Acquire would see this state if Sweep removed the
	// entry between its w.mu.Unlock and e.mu.Lock.
	first := w.Acquire(k)
	first.Push(&pb.PairedEvent{EventId: "stale"}, "M0")
	w.mu.Lock()
	delete(w.entries, k)
	w.mu.Unlock()
	first.Release()

	// New Acquire must find the entry missing, create a fresh one,
	// and return a Handle whose History is empty (not the stale
	// "first" entry's content).
	h := w.Acquire(k)
	defer h.Release()
	if hs := h.History(); len(hs) != 0 {
		t.Errorf("post-eviction Acquire yielded stale history len=%d; want 0", len(hs))
	}
	w.mu.Lock()
	cur, ok := w.entries[k]
	w.mu.Unlock()
	if !ok {
		t.Error("expected map to contain a fresh entry after Acquire")
	}
	if cur != h.entry {
		t.Error("Handle's entry doesn't match the entry stored in the map")
	}
}

func TestGuidIsolatedAcrossKeys(t *testing.T) {
	w := NewSlidingWindow(WindowOpts{Size: 4, TTL: time.Hour})

	hA := w.Acquire(Key{"s1", "i", "a"})
	gA := hA.Guid()
	hA.Release()

	hB := w.Acquire(Key{"s2", "i", "a"})
	gB := hB.Guid()
	hB.Release()

	if gA == gB {
		t.Errorf("different keys should yield different Guids; both = %q", gA)
	}
}

func TestKeyFromEvent(t *testing.T) {
	if got := keyFromEvent(nil); got.complete() {
		t.Error("nil event should produce an incomplete key")
	}
	ev := &pb.PairedEvent{
		SessionId:    "s",
		InvocationId: "i",
		Agent:        &pb.AgentContext{AgentId: "a"},
	}
	if got := keyFromEvent(ev); !got.complete() {
		t.Errorf("complete event yielded incomplete key: %+v", got)
	}
}
