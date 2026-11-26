import {NextResponse} from "next/server";import {requireApiRepositoryAccess} from "@/lib/auth";import {noStoreHeaders} from "@/lib/auth-core";import {getSafeCodexConnectionStatus} from "@/lib/codex-runner-status";
import {getRuntimeCodexRunnerClient} from "@/lib/workflow-services";
export async function GET(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;return NextResponse.json(await getSafeCodexConnectionStatus({clientFactory:()=>getRuntimeCodexRunnerClient(auth.access.repositoryId)}),{headers:noStoreHeaders})}
