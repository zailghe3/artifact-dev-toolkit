export type SafeDiagnosticField = string | number | boolean | null;
export type SafeDiagnosticReport = {
  domain: string;
  observedAt: string;
  status: string;
  reasons?: readonly string[];
  technical: Readonly<Record<string, SafeDiagnosticField | readonly SafeDiagnosticField[]>>;
};

// Reports accept only explicitly selected scalar fields. Arbitrary diagnostic,
// response, header, environment, or credential objects cannot cross this API.
export function diagnosticSummary(report: SafeDiagnosticReport): string {
  const lines = [`${report.domain} diagnostics`, `Observed: ${report.observedAt}`, `Status: ${report.status}`];
  if (report.reasons?.length) lines.push(...report.reasons.map(reason => `- ${reason}`));
  return lines.join("\n");
}

export function diagnosticTechnicalDetails(report: SafeDiagnosticReport): string {
  return JSON.stringify({ schema: "adt.safe-diagnostics.v1", domain: report.domain, observedAt: report.observedAt, status: report.status, reasons: report.reasons ?? [], technical: report.technical }, null, 2);
}
