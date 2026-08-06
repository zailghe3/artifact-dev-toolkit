export default async function Page({params}:{params:Promise<{agentId:string}>}){return <h1 className="text-3xl font-black">Agent {(await params).agentId}</h1>}
