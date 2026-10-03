import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {InitOptions} from "@secureagentics/adrian";

export type AdrianLocalLifecycle=Readonly<{
 init(options:InitOptions):Promise<void>;
 shutdown():Promise<void>;
}>;

type LocalLogDependencies=Readonly<{
 temporaryDirectory:()=>string;
 makeTemporaryDirectory:(prefix:string)=>Promise<string>;
 removeTemporaryDirectory:(path:string)=>Promise<void>;
}>;

const defaults:LocalLogDependencies={
 temporaryDirectory:tmpdir,
 makeTemporaryDirectory:prefix=>mkdtemp(prefix),
 removeTemporaryDirectory:path=>rm(path,{recursive:true,force:true}),
};

export type AdrianLocalLifecycleFailureReason="local_log_unavailable"|"sdk_init_failed";

export class AdrianLocalLifecycleError extends Error{
 constructor(readonly reason:AdrianLocalLifecycleFailureReason){super("Adrian security initialization failed safely.");this.name="AdrianLocalLifecycleError"}
}

/**
 * Runs one process-global Adrian lifecycle with an isolated, ephemeral JSONL sink.
 * Shutdown and removal are best-effort so they cannot replace an established result.
 */
export async function withAdrianLocalLog<T>(runtime:AdrianLocalLifecycle,options:InitOptions,operation:()=>Promise<T>,dependencies:Partial<LocalLogDependencies>={}):Promise<T>{
 const io={...defaults,...dependencies};let directory:string;
 try{directory=await io.makeTemporaryDirectory(join(io.temporaryDirectory(),"adt-adrian-"))}catch{throw new AdrianLocalLifecycleError("local_log_unavailable")}
 try{
  try{await runtime.init({...options,logFile:join(directory,"events.jsonl")})}catch{throw new AdrianLocalLifecycleError("sdk_init_failed")}
  return await operation()
 }finally{
  try{await runtime.shutdown()}catch{/* Best-effort: never replace the security or execution outcome. */}
  try{await io.removeTemporaryDirectory(directory)}catch{/* Ephemeral cleanup must not replace an established outcome. */}
 }
}
