export function deferred(){
  let resolve;
  let reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no});
  return{promise,resolve,reject};
}

export async function withDeadline(promise,message,timeoutMs=2_000){
  let timer;
  try{
    return await Promise.race([
      promise,
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeoutMs)}),
    ]);
  }finally{
    clearTimeout(timer);
  }
}

export async function until(predicate,message,{timeoutMs=2_000}={}){
  const deadline=Date.now()+timeoutMs;
  while(true){
    if(await predicate())return;
    if(Date.now()>=deadline)throw new Error(message);
    await new Promise(resolve=>setImmediate(resolve));
  }
}
