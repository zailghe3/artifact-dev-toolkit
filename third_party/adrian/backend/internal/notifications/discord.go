// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

// Package notifications dispatches verdict alerts to user-configured
// channels. Today this is Discord webhook URLs; future platforms slot
// in alongside without restructuring.
package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/secureagentics/Adrian/backend/internal/alerts"
)

// allowedHosts caps the set of webhook URLs Send is willing to POST to.
// Discord webhooks accept either domain.
var allowedHosts = []string{
	"https://discord.com/api/webhooks/",
	"https://discordapp.com/api/webhooks/",
}

// ValidateDiscordWebhookURL returns nil if u is a well-formed Discord
// webhook URL. Mirrors the host-prefix check so the dispatcher and the
// REST validator agree on what's acceptable.
func ValidateDiscordWebhookURL(u string) error {
	for _, p := range allowedHosts {
		if strings.HasPrefix(u, p) {
			return nil
		}
	}
	return errors.New("webhook URL must point at https://discord.com/api/webhooks/...")
}

// discordPayload is the minimal subset of the Discord webhook body we
// need: a content string (fallback) plus a single embed (the rendered
// alert). We send both so a user with embeds disabled still sees text.
type discordPayload struct {
	Content string         `json:"content,omitempty"`
	Embeds  []discordEmbed `json:"embeds,omitempty"`
}

type discordEmbed struct {
	Title       string         `json:"title,omitempty"`
	URL         string         `json:"url,omitempty"`
	Description string         `json:"description,omitempty"`
	Color       int            `json:"color,omitempty"`
	Fields      []discordField `json:"fields,omitempty"`
	Timestamp   string         `json:"timestamp,omitempty"`
}

type discordField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

// Alert holds the data the dispatcher renders into a Discord message.
// The classifier's raw reasoning (model chain-of-thought) is left out
// on purpose: it can leak prompt-injection material verbatim to the
// notification channel and isn't useful as an at-a-glance alert.
// Operators who need it can query the SQLite verdicts table.
type Alert struct {
	EventID        string
	SessionID      string
	AgentID        string
	MADCode        string
	Classification string
	DashboardURL   string // base URL, no trailing slash
}

// Send POSTs the alert to the webhook URL. Caller-provided ctx caps the
// total request budget; the function uses an internal 5-second timeout
// if the ctx has none.
func Send(ctx context.Context, webhookURL string, alert Alert) error {
	if err := ValidateDiscordWebhookURL(webhookURL); err != nil {
		return err
	}
	payload, err := json.Marshal(buildPayload(alert))
	if err != nil {
		return err
	}

	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Adrian-OSS-Webhook/1")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return fmt.Errorf("discord webhook returned %d: %s", resp.StatusCode, body)
}

// buildPayload renders the JSON the Discord webhook expects.
// Color picks a severity hue: M4 red, M3 amber, anything else neutral.
//
// Description and title come from the curated alerts bundle keyed by
// the verdict's mad_code. Showing the model's raw reasoning would
// risk leaking prompt-injection material verbatim, so the alert text
// is always pre-written and stable.
func buildPayload(a Alert) discordPayload {
	link := a.DashboardURL
	if a.SessionID != "" {
		link += "/sessions/" + a.SessionID
		if a.EventID != "" {
			link += "#event-" + a.EventID
		}
	}

	color := 0x6b6b80 // muted neutral
	switch {
	case strings.HasPrefix(a.MADCode, "M4"):
		color = 0xff4757 // danger
	case strings.HasPrefix(a.MADCode, "M3"):
		color = 0xffa502 // warn
	}

	title := "Adrian verdict"
	desc := "Adrian flagged an event. Open the dashboard for full context."

	canned, hasCanned := alerts.Lookup(a.MADCode)
	if hasCanned {
		title = canned.SeverityLabel + ": " + canned.Subcategory
		desc = canned.Description
		if canned.Example != "" {
			desc += "\n\n**For example:** " + canned.Example
		}
	}

	fields := []discordField{
		{Name: "MAD code", Value: codeOrDash(a.MADCode), Inline: true},
		{Name: "Classification", Value: codeOrDash(a.Classification), Inline: true},
	}
	if hasCanned {
		fields = append(fields, discordField{
			Name:   "Action",
			Value:  canned.DefaultAction,
			Inline: true,
		})
	}
	if a.AgentID != "" {
		fields = append(fields, discordField{Name: "Agent", Value: a.AgentID, Inline: true})
	}
	if a.SessionID != "" {
		fields = append(fields, discordField{Name: "Session", Value: a.SessionID, Inline: false})
	}
	if link != "" {
		// Embed field values render Discord markdown, so wrap the URL
		// in a labelled hyperlink. The embed title also points at this
		// URL; both are kept so the link is reachable whether the user
		// clicks the title or scans the field rows.
		fields = append(fields, discordField{
			Name:   "Dashboard",
			Value:  fmt.Sprintf("[Open in dashboard](%s)", link),
			Inline: false,
		})
	}

	return discordPayload{
		Content: fmt.Sprintf("Adrian alert: %s on session %s", codeOrDash(a.MADCode), shortSession(a.SessionID)),
		Embeds: []discordEmbed{{
			Title:       title,
			URL:         link,
			Description: truncate(desc, 1500),
			Color:       color,
			Fields:      fields,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	}
}

func codeOrDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

func shortSession(s string) string {
	if len(s) > 16 {
		return s[:16] + "..."
	}
	return s
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
