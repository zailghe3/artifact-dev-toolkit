export default async function Page({params}:{params:Promise<{workflowId:string}>}){return <h1 className="text-3xl font-black">Edit workflow {(await params).workflowId}</h1>}
