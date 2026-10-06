// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

// Package alerts ships the curated, user-facing explanations the
// dashboard and notification surfaces show in place of the raw
// classifier reasoning. The model's chain-of-thought can carry
// prompt-injection material verbatim, so showing it is unsafe;
// each verdict's MAD subcode maps to a pre-written description,
// example, and one or more framework references.
package alerts

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

//go:embed alerts.json
var alertsBundleJSON []byte

// Reference is one external framework citation.
type Reference struct {
	Framework  string `json:"framework"`
	Identifier string `json:"identifier"`
	URL        string `json:"url"`
}

// Alert is one MAD-subcode entry the dashboard can render verbatim.
type Alert struct {
	Code          string      `json:"code"`
	Severity      string      `json:"severity"`       // "M2" | "M3" | "M4"
	SeverityLabel string      `json:"severity_label"` // human label
	Subcategory   string      `json:"subcategory"`
	Description   string      `json:"description"`
	Example       string      `json:"example"`
	DefaultAction string      `json:"default_action"` // "NOTIFY" | "BLOCK" | "ESCALATE"
	References    []Reference `json:"references"`
}

// Bundle is the entire mad_alerts.json payload, ready to ship to the
// dashboard or to lookup in-process.
type Bundle struct {
	DefaultAction map[string]string `json:"default_action"`
	Alerts        map[string]Alert  `json:"alerts"`
}

var (
	loaded   Bundle
	loadOnce sync.Once
	loadErr  error
)

// Get returns the parsed alerts bundle. Parsing is done lazily on
// first call and cached for the lifetime of the process.
func Get() (*Bundle, error) {
	loadOnce.Do(func() {
		var b Bundle
		if err := json.Unmarshal(alertsBundleJSON, &b); err != nil {
			loadErr = fmt.Errorf("alerts: parse embedded JSON: %w", err)
			return
		}
		loaded = b
	})
	if loadErr != nil {
		return nil, loadErr
	}
	return &loaded, nil
}

// MustGet is Get with a panic on failure. The JSON is embedded at
// build time, so a parse error is a programming error.
func MustGet() *Bundle {
	b, err := Get()
	if err != nil {
		panic(err)
	}
	return b
}

// Lookup resolves a verdict's mad_code to its alert entry. Empty or
// M0 codes return (nil, false), those are benign and have no
// surface-level explanation. A subcoded value (e.g. "M3.a") returns
// the exact entry. A bare base code (e.g. "M3") returns (nil, false);
// callers should fall back to BaseSeverity for the action mapping.
func Lookup(madCode string) (*Alert, bool) {
	if madCode == "" || strings.HasPrefix(madCode, "M0") {
		return nil, false
	}
	b := MustGet()
	if a, ok := b.Alerts[madCode]; ok {
		return &a, true
	}
	return nil, false
}

// BaseSeverity returns the default action for a bare M-code (e.g.
// "M3" → "BLOCK"). Returns "" if the code is unrecognised. Used as
// the fallback when Lookup misses (e.g. an M-code with an unknown
// suffix that the model made up).
func BaseSeverity(madCode string) string {
	if len(madCode) < 2 {
		return ""
	}
	prefix := madCode[:2]
	b := MustGet()
	return b.DefaultAction[prefix]
}
