import {ZodError} from "zod";
import {noStoreHeaders} from "./auth-core.ts";
export function knowledgeError(error:unknown){
 const code=error instanceof ZodError?"knowledge_invalid":error instanceof Error?error.message:"knowledge_unavailable";
 const errors:Record<string,[number,string]>={
  knowledge_invalid:[400,"Knowledge metadata or Markdown is invalid. Check the ID, type, status and references."],
  knowledge_too_large:[413,"Knowledge must fit within 32 KiB, including metadata."],body_too_large:[413,"The proposal is too large."],invalid_json:[400,"The request is invalid."],
  permission_denied:[403,"Current repository authority is required."],invalid_origin:[403,"Publication requires the trusted application interface."],
  knowledge_review_required:[409,"Review the saved proposal again before explicitly approving publication."],
  knowledge_conflict:[409,"Knowledge or proposal changed. Open the current Git entry and prepare a new review."],
  knowledge_proposal_not_found:[404,"Proposal not found in this repository for your account."],
  knowledge_publish_uncertain:[503,"Publication outcome is uncertain. Inspect the Git entry before preparing another proposal. ADT will not retry this publication."],
  knowledge_library_limit:[503,"Knowledge search exceeds the bounded library scan. Retrieve a specific entry by ID or reduce the library size."],
 };
 const [status,message]=errors[code]??[503,"Knowledge is temporarily unavailable. No automatic publication retry was made."];
 return Response.json({error:message,code:errors[code]?code:"knowledge_unavailable"},{status,headers:noStoreHeaders});
}
export function requireKnowledgeIntent(request:Request){if(request.headers.get("origin")!==new URL(request.url).origin||request.headers.get("sec-fetch-site")==="cross-site")throw Error("invalid_origin")}
