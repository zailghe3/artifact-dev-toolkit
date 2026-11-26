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
  return (
    <section id="maintenance" aria-labelledby="maintenance-heading" className="adt-panel sm:p-5">
      <h2 id="maintenance-heading" className="text-lg font-semibold tracking-tight">{item ? "Maintenance due" : "Maintenance"}</h2>
      {item
        ? <p className="mt-1 text-sm"><a className="font-semibold underline underline-offset-2" href={item.href}>{item.message}</a></p>
        : <p className="mt-1 text-sm text-muted-foreground"><a className="underline underline-offset-2" href="#application-control-plane">Check infrastructure freshness</a> for available component updates.</p>}
    </section>
  );
}

export function useDiagnosticsMaintenance() {
  const value = useContext(Context);
  if (!value) throw new Error("Diagnostics maintenance context is unavailable.");
  return value;
}
