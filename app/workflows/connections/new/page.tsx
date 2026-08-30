import {ProviderConnectionEditor} from "@/components/ProviderConnectionEditor";
import {requireRepositoryAccess} from "@/lib/auth";

export default async function Page(){await requireRepositoryAccess("/workflows/connections/new");return <><h1 className="text-3xl font-black">New connection</h1><p className="mt-2 text-slate-600 dark:text-slate-300">Create a Git-managed connection with a credential stored in the ADT vault.</p><ProviderConnectionEditor/></>}
