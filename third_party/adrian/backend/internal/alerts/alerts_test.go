// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package alerts

import "testing"

func TestBundleParses(t *testing.T) {
	b, err := Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(b.Alerts) == 0 {
		t.Fatal("Bundle has no alerts")
	}
	for _, want := range []string{"M2", "M3", "M4"} {
		if _, ok := b.DefaultAction[want]; !ok {
			t.Errorf("default_action missing %q", want)
		}
	}
}

func TestLookupKnownSubcodes(t *testing.T) {
	cases := []struct {
		code         string
		wantSeverity string
		wantAction   string
	}{
		{"M2.a", "M2", "NOTIFY"},
		{"M3.b", "M3", "BLOCK"},
		{"M4.d", "M4", "ESCALATE"},
	}
	for _, c := range cases {
		a, ok := Lookup(c.code)
		if !ok {
			t.Errorf("Lookup(%q) miss", c.code)
			continue
		}
		if a.Severity != c.wantSeverity {
			t.Errorf("Lookup(%q).Severity = %q, want %q", c.code, a.Severity, c.wantSeverity)
		}
		if a.DefaultAction != c.wantAction {
			t.Errorf("Lookup(%q).DefaultAction = %q, want %q", c.code, a.DefaultAction, c.wantAction)
		}
		if a.Description == "" || a.Subcategory == "" || a.SeverityLabel == "" {
			t.Errorf("Lookup(%q): empty user-visible field on entry %+v", c.code, a)
		}
	}
}

func TestLookupBenignAndUnknown(t *testing.T) {
	for _, code := range []string{"", "M0", "M0.x", "MX.y", "M99"} {
		if _, ok := Lookup(code); ok {
			t.Errorf("Lookup(%q) should miss", code)
		}
	}
}

func TestLookupBareBaseCodeMisses(t *testing.T) {
	// Bare base codes (M2, M3, M4 with no subcode) are not in the
	// alerts map; callers must use BaseSeverity for the action.
	for _, code := range []string{"M2", "M3", "M4"} {
		if _, ok := Lookup(code); ok {
			t.Errorf("Lookup(%q) should miss; bare base codes resolve via BaseSeverity", code)
		}
	}
}

func TestBaseSeverity(t *testing.T) {
	cases := map[string]string{
		"M2":   "NOTIFY",
		"M3":   "BLOCK",
		"M4":   "ESCALATE",
		"M2.a": "NOTIFY",
		"M3.x": "BLOCK", // unknown subcode, but base prefix resolves
		"M0":   "",
		"":     "",
	}
	for code, want := range cases {
		if got := BaseSeverity(code); got != want {
			t.Errorf("BaseSeverity(%q) = %q, want %q", code, got, want)
		}
	}
}
