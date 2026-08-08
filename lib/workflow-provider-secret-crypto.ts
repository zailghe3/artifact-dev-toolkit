export type EncryptedProviderCredentialV1={version:1;ciphertext:string;iv:string};
export class ProviderSecretCryptoError extends Error{readonly code;constructor(code:"provider_secret_key_invalid"|"provider_secret_encryption_failed"|"provider_secret_decryption_failed"|"provider_secret_version_unsupported"){super(code);this.code=code;}}
const encoder=new TextEncoder();
function decodeKey(value:string|undefined){
 if(!value)throw new ProviderSecretCryptoError("provider_secret_key_invalid");
 try{const bytes=Uint8Array.from(Buffer.from(value,"base64"));if(bytes.length!==32||Buffer.from(bytes).toString("base64")!==value)throw new Error();return bytes;}catch{throw new ProviderSecretCryptoError("provider_secret_key_invalid");}
}
const aad=(key:string,adapter:string)=>encoder.encode(`workflow-provider-secret:v1:${key}:${adapter}`);
export function providerSecretStorageAvailable(root:string|undefined){try{decodeKey(root);return true;}catch{return false;}}
export async function encryptProviderCredential(plaintext:string,root:string|undefined,key:string,adapter:string):Promise<EncryptedProviderCredentialV1>{
 try{const cryptoKey=await crypto.subtle.importKey("raw",decodeKey(root),"AES-GCM",false,["encrypt"]),iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad(key,adapter)},cryptoKey,encoder.encode(plaintext));return{version:1,ciphertext:Buffer.from(encrypted).toString("base64"),iv:Buffer.from(iv).toString("base64")};}catch(error){if(error instanceof ProviderSecretCryptoError)throw error;throw new ProviderSecretCryptoError("provider_secret_encryption_failed");}
}
export async function decryptProviderCredential(envelope:{version:number;ciphertext:string;iv:string},root:string|undefined,key:string,adapter:string){
 if(envelope.version!==1)throw new ProviderSecretCryptoError("provider_secret_version_unsupported");
 try{const cryptoKey=await crypto.subtle.importKey("raw",decodeKey(root),"AES-GCM",false,["decrypt"]),iv=Uint8Array.from(Buffer.from(envelope.iv,"base64")),ciphertext=Uint8Array.from(Buffer.from(envelope.ciphertext,"base64"));if(iv.length!==12||Buffer.from(iv).toString("base64")!==envelope.iv||Buffer.from(ciphertext).toString("base64")!==envelope.ciphertext)throw new Error();const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:aad(key,adapter)},cryptoKey,ciphertext);return new TextDecoder().decode(clear);}catch(error){if(error instanceof ProviderSecretCryptoError)throw error;throw new ProviderSecretCryptoError("provider_secret_decryption_failed");}
}
