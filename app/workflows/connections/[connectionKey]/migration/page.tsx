import {notFound} from "next/navigation";
import {requireRepositoryAccess} from "@/lib/auth";
import {getWorkflowProviderConnectionMigrationService} from "@/lib/workflow-services";
import {ConnectionMigrationError} from "@/lib/workflow-provider-connection-migration";
import {ProviderConnectionMigration} from "@/components/ProviderConnectionMigration";
export default async function Page({params}:{params:Promise<{connectionKey:string}>}){const {access}=await requireRepositoryAccess("/workflows/connections"),key=(await params).connectionKey;let migration;try{migration=await(await getWorkflowProviderConnectionMigrationService(access)).inspect(key)}catch(error){if(error instanceof ConnectionMigrationError&&error.code==="migration_source_not_found")notFound();throw error}return <><h1 className="text-3xl font-black">Migrate to ADT vault</h1><p className="mt-3 text-slate-600 dark:text-slate-300">Explicitly copy the active legacy credential server-side into the permanent ADT vault. Credential values never pass through the browser or Git.</p><ProviderConnectionMigration initial={migration}/></>}
