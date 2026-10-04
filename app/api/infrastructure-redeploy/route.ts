import {requireApiRepositoryAccess} from "@/lib/auth";
import {getFreshInfrastructureFreshnessSnapshot,invalidateInfrastructureFreshnessCache} from "@/lib/infrastructure-freshness-live";
import {redeployInfrastructure} from "@/lib/workflow-services";
import {handleInfrastructureRedeploy} from "@/lib/infrastructure-redeploy-action";

export const dynamic="force-dynamic";
export async function POST(request:Request){return handleInfrastructureRedeploy(request,{authorize:requireApiRepositoryAccess,freshness:getFreshInfrastructureFreshnessSnapshot,redeploy:redeployInfrastructure,invalidate:invalidateInfrastructureFreshnessCache})}
