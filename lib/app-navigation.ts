export const applicationIdentity = {
  name: "Artifact Toolkit",
  purpose: "Manage reusable work assets",
} as const;

export const primaryNavigation = [
  { label: "Artifacts", href: "/", match: ["/", "/artifacts"] },
  { label: "Workflows", href: "/workflows", match: ["/workflows"] },
  { label: "Diagnostics", href: "/diagnostics", match: ["/diagnostics"] },
] as const;

export type PrimaryNavigationItem = (typeof primaryNavigation)[number];

export function isPrimaryNavigationActive(item: PrimaryNavigationItem, pathname: string) {
  const normalized = pathname === "" ? "/" : pathname;
  return item.match.some((prefix) => normalized === prefix || (prefix !== "/" && normalized.startsWith(`${prefix}/`)));
}

export function primaryNavigationState(pathname: string) {
  return primaryNavigation.map((item) => ({ ...item, active: isPrimaryNavigationActive(item, pathname) }));
}
