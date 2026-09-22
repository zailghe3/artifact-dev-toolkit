"use client";
import { createContext, useContext, useMemo, useState } from "react";
import { infrastructureFreshnessLabel, type InfrastructureFreshnessSnapshot } from "@/lib/infrastructure-freshness";

export type MaintenanceItem = { id: string; message: string; href: string };
type ContextValue = { infrastructure?: MaintenanceItem; setInfrastructureMaintenance: (item?: MaintenanceItem) => void };
const Context = createContext<ContextValue | undefined>(undefined);

export function infrastructureMaintenanceItem(snapshot?: InfrastructureFreshnessSnapshot): MaintenanceItem | undefined {
  return snapshot?.state === "superseded" ? { id: "infrastructure-freshness", message: infrastructureFreshnessLabel(snapshot), href: "#application-control-plane" } : undefined;
}

export function DiagnosticsMaintenanceProvider({ children }: { children: React.ReactNode }) {
  const [infrastructure, setInfrastructureMaintenance] = useState<MaintenanceItem>();
  const value = useMemo(() => ({ infrastructure, setInfrastructureMaintenance }), [infrastructure]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function MaintenanceDuePanel() {
  const item = useDiagnosticsMaintenance().infrastructure;
  if (!item) return null;
  return <section aria-labelledby="maintenance-due-heading" className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-700 dark:bg-slate-900"><h2 id="maintenance-due-heading" className="text-xl font-black">Maintenance due</h2><ul className="mt-2 list-disc pl-5 text-sm"><li><a className="font-semibold underline underline-offset-2" href={item.href}>{item.message}</a></li></ul></section>;
}

export function useDiagnosticsMaintenance() {
  const value = useContext(Context);
  if (!value) throw new Error("Diagnostics maintenance context is unavailable.");
  return value;
}
