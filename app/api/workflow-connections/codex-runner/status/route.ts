import {NextResponse} from "next/server";import {getSafeCodexConnectionStatus} from "@/lib/codex-runner-status";
export async function GET(){return NextResponse.json(await getSafeCodexConnectionStatus(),{headers:{"cache-control":"no-store"}})}
