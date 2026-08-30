import fs from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_ARTIFACT_DIRECTORIES,
  DEFAULT_ARTIFACT_BRANCH,
  DEFAULT_ARTIFACT_ROOT,
  formatZodIssue,
  artifactFrontMatterSchema,
  type ArtifactMetadata as ExternalArtifactMetadata,
  type ArtifactRepositoryValidationError,
  type ArtifactRepositoryValidationResult,
} from "./artifact-contract.ts";
import { ARTIFACT_DIRECTORIES, classifyArtifactPath } from "./repository-layout.ts";
import matter from "gray-matter";
import { z } from "zod";
import {CONNECTION_ROOT,CONNECTION_SUFFIX,parseConnectionDefinition} from "./workflow-connection-definitions.ts";

export { ALLOWED_ARTIFACT_DIRECTORIES as EXTERNAL_ARTIFACT_DIRECTORIES, DEFAULT_ARTIFACT_BRANCH as DEFAULT_EXTERNAL_ARTIFACT_BRANCH, DEFAULT_ARTIFACT_ROOT as DEFAULT_EXTERNAL_ARTIFACT_ROOT };
export type { ExternalArtifactMetadata, ArtifactRepositoryValidationError, ArtifactRepositoryValidationResult };

export type ArtifactRepositoryContract = { authoritativeBranch: string; rootPath: string; directories: readonly string[]; nestedDirectories: "supported"; idUniqueness: "global" };
export const externalArtifactRepositoryContract: ArtifactRepositoryContract = { authoritativeBranch: DEFAULT_ARTIFACT_BRANCH, rootPath: DEFAULT_ARTIFACT_ROOT, directories: ALLOWED_ARTIFACT_DIRECTORIES, nestedDirectories: "supported", idUniqueness: "global" };

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkMarkdownFiles(fullPath);
      if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
      return [];
    }))).flat();
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
async function walkConnectionFiles(dir:string):Promise<string[]>{try{const entries=await fs.readdir(dir,{withFileTypes:true});return(await Promise.all(entries.map(entry=>{const full=path.join(dir,entry.name);if(entry.isDirectory())return walkConnectionFiles(full);if(entry.isFile())return[full];return[]}))).flat()}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return[];throw error}}
function normalizeRelative(file: string, root: string) { return path.relative(root, file).split(path.sep).join("/"); }

export async function validateExternalArtifactRepository(checkoutDir: string): Promise<ArtifactRepositoryValidationResult> {
  const checkoutRoot=path.resolve(checkoutDir),errors:ArtifactRepositoryValidationError[]=[],ids=new Map<string,string>();let artifactCount=0;
  const roots=ARTIFACT_DIRECTORIES.map(directory=>path.join(checkoutRoot,directory));
  const files=new Map<string,string>();for(const file of (await Promise.all(roots.map(walkMarkdownFiles))).flat())files.set(normalizeRelative(file,checkoutRoot),file);
  const retiredRoots=["artifacts/prompts","artifacts/agents","artifacts/snippets","artifacts/templates","artifacts/app-ideas","artifacts/variations","variations","_adt/agents","_adt/workflows"];
  for(const retiredRoot of retiredRoots){for(const file of await walkConnectionFiles(path.join(checkoutRoot,retiredRoot)))errors.push({file:normalizeRelative(file,checkoutRoot),reason:`Active content under retired repository location ${retiredRoot}/ is not supported.`});}
  for(const [displayPath,file] of files){if(!classifyArtifactPath(displayPath)){errors.push({file:displayPath,reason:"Markdown artifact path is not canonical."});continue}let parsed:matter.GrayMatterFile<string>;try{parsed=matter(await fs.readFile(file,"utf8"),{})}catch(error){errors.push({file:displayPath,reason:`Unable to parse Markdown front matter: ${(error as Error).message}`});continue}if(!String(parsed.matter??"").trim()){errors.push({file:displayPath,reason:"Missing YAML front matter."});continue}try{const data=artifactFrontMatterSchema.parse(parsed.data);artifactCount++;const previous=ids.get(data.id);if(previous)errors.push({file:displayPath,reason:`Duplicate artifact id "${data.id}" already used by ${previous}.`});else ids.set(data.id,displayPath)}catch(error){if(error instanceof z.ZodError)for(const issue of error.issues)errors.push({file:displayPath,reason:formatZodIssue(issue)});else errors.push({file:displayPath,reason:(error as Error).message})}}
  const connectionIds=new Map<string,string>();
  for(const file of await walkConnectionFiles(path.join(checkoutRoot,CONNECTION_ROOT))){const displayPath=normalizeRelative(file,checkoutRoot);if(!displayPath.endsWith(CONNECTION_SUFFIX)||displayPath.split("/").length!==2){errors.push({file:displayPath,reason:"Connection definitions must use connections/<id>.connection.json."});continue}try{const definition=parseConnectionDefinition(JSON.parse(await fs.readFile(file,"utf8")),displayPath),previous=connectionIds.get(definition.id);if(previous)errors.push({file:displayPath,reason:`Duplicate connection id "${definition.id}" already used by ${previous}.`});else connectionIds.set(definition.id,displayPath)}catch(error){if(error instanceof z.ZodError)for(const issue of error.issues)errors.push({file:displayPath,reason:formatZodIssue(issue)});else errors.push({file:displayPath,reason:(error as Error).message})}}
  return { valid: errors.length === 0, artifactCount, errors };
}
