// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package engine

import (
	"context"

	"github.com/secureagentics/Adrian/backend/internal/store"
)

// chatMessage is one entry in the OpenAI-style messages array.
type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// buildMessages returns the message array for one classify call. The
// system prompt is rendered fresh per call from the agent profile +
// per-conversation guid; the few-shot pair demonstrates the
// adrian-untrusted convention before any real history; prior turns
// from the sliding window slot in next; the current event lands as
// the final user message.
//
// All untrusted interpolations carry the same guid, so the model sees
// one consistent boundary across the whole call.
func buildMessages(ctx context.Context, trace string, history []HistoryItem, profile *store.AgentProfile, guid string) []chatMessage {
	msgs := make([]chatMessage, 0, 4+2*len(history))
	msgs = append(msgs,
		chatMessage{Role: "system", Content: renderPolicy(ctx, profile, guid)},
		chatMessage{Role: "user", Content: renderFewShotUser(guid)},
		chatMessage{Role: "assistant", Content: fewShotAssistant},
	)
	for _, item := range history {
		priorCode := item.MADCode
		if priorCode == "" {
			priorCode = "M0"
		}
		msgs = append(msgs,
			chatMessage{Role: "user", Content: "Classify this agent trace:\n\n" + extractTrace(item.Event, guid)},
			chatMessage{Role: "assistant", Content: priorCode},
		)
	}
	msgs = append(msgs, chatMessage{Role: "user", Content: "Classify this agent trace:\n\n" + trace})
	return msgs
}
