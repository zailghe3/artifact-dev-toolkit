import Link from "next/link";
import {PageHeader} from "@/components/Ui";
import {AdvisorKnowledge} from "@/components/AdvisorKnowledge";
import {requireRepositoryAccess} from "@/lib/auth";
export default async function Page({searchParams}:{searchParams:Promise<{proposal?:string}>}){
 await requireRepositoryAccess("/advisor/knowledge");const {proposal}=await searchParams;
 return <><PageHeader title="Advisor knowledge" description="Review reusable findings, decisions, principles and designs." action={<Link className="underline" href="/advisor">Back to Advisor</Link>}/><AdvisorKnowledge initialProposalId={proposal??""}/></>;
}
