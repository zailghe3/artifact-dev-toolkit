export type WorkflowSection = {
  label: string;
  href: string;
  matches: (path: string) => boolean;
};

export const workflowSections: WorkflowSection[] = [
  { label: 'Overview', href: '/workflows', matches: (path) => path === '/workflows' },
  { label: 'Runs', href: '/workflows/runs', matches: (path) => path === '/workflows/runs' || path.startsWith('/workflows/runs/') },
  { label: 'Workflows', href: '/workflows/definitions', matches: (path) => path === '/workflows/definitions' || path.startsWith('/workflows/definitions/') },
  { label: 'Agents', href: '/workflows/agents', matches: (path) => path === '/workflows/agents' || path.startsWith('/workflows/agents/') },
  { label: 'Connections', href: '/workflows/connections', matches: (path) => path === '/workflows/connections' || path.startsWith('/workflows/connections/') },
  { label: 'Codex environments', href: '/workflows/codex-environments', matches: (path) => path === '/workflows/codex-environments' || path.startsWith('/workflows/codex-environments/') },
];

export function workflowSectionState(pathname: string) {
  return workflowSections.map(({ label, href, matches }) => ({ label, href, active: matches(pathname) }));
}
