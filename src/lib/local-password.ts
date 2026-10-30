/** Browser profiles are local convenience, not a server authorization boundary. */
const ITERATIONS = 600000;
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const result = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt),iterations:ITERATIONS}, key, 256);
  return hex(new Uint8Array(result));
}
export async function hashLocalPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${hex(salt)}$${await derive(password,salt)}`;
}
export async function verifyLocalPassword(password: string, encoded: string): Promise<{valid:boolean;upgrade:boolean}> {
  if (!encoded.startsWith('pbkdf2-sha256$')) {
    // Compatibility only: replace the old reversible value after successful login.
    const bytes = new TextEncoder().encode(`hexaview:${password}`);
    const legacy = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
    return {valid:legacy===encoded,upgrade:true};
  }
  const parts=encoded.split('$');
  if(parts.length!==4||parts[1]!==String(ITERATIONS)||! /^[a-f0-9]{32}$/.test(parts[2])||! /^[a-f0-9]{64}$/.test(parts[3]))return {valid:false,upgrade:false};
  const salt=Uint8Array.from(parts[2].match(/../g)!,x=>parseInt(x,16));
  const actual=await derive(password,salt);
  let difference=0;for(let i=0;i<actual.length;i++)difference|=actual.charCodeAt(i)^parts[3].charCodeAt(i);
  return {valid:difference===0,upgrade:false};
}
