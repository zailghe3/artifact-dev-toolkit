import {PageHeader} from "@/components/Ui";
import {ProviderConnectionEditor} from "@/components/ProviderConnectionEditor";
import {requireRepositoryAccess} from "@/lib/auth";
import {getWorkflowProviderConnectionStore} from "@/lib/workflow-services";
import {duplicateConnectionDraft} from "@/lib/provider-connection-presentation";

export default async function Page({searchParams}:{searchParams:Promise<{duplicate?:string}>}){const {access}=await requireRepositoryAccess("/workflows/connections/new"),sourceKey=(await searchParams).duplicate,store=await getWorkflowProviderConnectionStore(access),connections=sourceKey?await store.listSafeDescriptors():[],source=connections.find(item=>item.key===sourceKey&&item.management==="git"),initial=source?duplicateConnectionDraft(source,new Set(connections.map(item=>item.key))):undefined;return <><PageHeader title={initial?`Duplicate ${source!.name}`:"New connection"} description={initial?"Review this unsaved copy, provide its own credential, and save it as a distinct connection.":"Create a Git-managed connection with a credential stored in the ADT vault."}/><ProviderConnectionEditor initial={initial}/></>}
