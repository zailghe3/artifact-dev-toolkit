import { requireApiDiagnosticsAccess } from "@/lib/auth";
import { artifactValidationRequest } from "@/lib/artifact-validation-request";
import { generateRepositoryDiagnostics } from "@/lib/repository-diagnostics";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return artifactValidationRequest(request, requireApiDiagnosticsAccess, async (session, signal) =>
    (await generateRepositoryDiagnostics(session, { includeValidation: true, signal })).validation);
}
