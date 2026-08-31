import type { ConnectionDescriptor } from './workflow-connections';
import { DEFINITION_ID_MAX_LENGTH, definitionIdFromName } from './definition-id.ts';
import { CONNECTION_NAME_MAX_LENGTH } from './workflow-connection-definitions.ts';

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

export function duplicateConnectionDraft(source: ConnectionDescriptor, existingKeys: Set<string>) {
  const sourceKey = definitionIdFromName(source.key);
  const candidate = (suffix: string) => `${sourceKey.slice(0, DEFINITION_ID_MAX_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
  let key = candidate('-copy');
  for (let copy = 2; existingKeys.has(key) || key === source.key; copy += 1) key = candidate(`-copy-${copy}`);
  const nameSuffix = ' copy';
  return {
    key,
    name: `${source.name.slice(0, CONNECTION_NAME_MAX_LENGTH - nameSuffix.length).trimEnd()}${nameSuffix}`,
    model: source.defaultModel ?? '',
    runtime: source.adapter as 'openai-responses' | 'openai-agents',
  };
}
