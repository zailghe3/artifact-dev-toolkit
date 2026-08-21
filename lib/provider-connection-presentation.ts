const failureMessages: Record<string, string> = {
  connection_unavailable: 'Connection is not configured.',
  authentication_failed: 'Authentication failed.',
  permission_denied: 'Permission denied.',
  provider_rejected: 'Configured model was rejected.',
  rate_limited: 'Provider rate limited.',
  provider_unavailable: 'Provider temporarily unavailable.',
  provider_timeout: 'Connection test timed out.',
  malformed_response: 'Provider returned an invalid response.',
  internal_error: 'Connection test could not be completed.',
};

export const providerConnectionOutputLimit = 100;

export function canTestProviderConnection({ busy, configured }: { busy: boolean; configured: boolean }) {
  return configured && !busy;
}

export function providerConnectionTestFeedback(value: unknown, responseOk = true) {
  if (responseOk && value && typeof value === 'object' && 'ok' in value && value.ok === true) {
    const output = 'output' in value && typeof value.output === 'string'
      ? ` — ${value.output.slice(0, providerConnectionOutputLimit)}`
      : '';
    return `Connection successful${output}`;
  }
  const category = value && typeof value === 'object' && 'category' in value && typeof value.category === 'string'
    ? value.category
    : 'internal_error';
  return failureMessages[category] ?? failureMessages.internal_error;
}
