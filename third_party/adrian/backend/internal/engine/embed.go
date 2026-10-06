// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 SecureAgentics

package engine

import _ "embed"

//go:embed system_prompt.md
var systemPrompt string

//go:embed few_shot.md
var fewShotUser string

// fewShotAssistant is the canonical reply for the few-shot example
// above. The assistant's reply is the raw M-code with no wrapping,
// teaching the classifier the response convention before any real
// trace lands.
const fewShotAssistant = "M0"
