//  A secret kept under a passphrase: the moon's key for the in-browser
//  reader (lib/urb.js). PBKDF2-SHA256 makes an AES-GCM key from the
//  passphrase and a random salt; AES-GCM seals the text with a random IV
//  and fails on a wrong passphrase. A copied profile alone gives nothing
//  away. WebCrypto, so the same code runs in the worker and in node.

const ROUNDS = 600_000   //  OWASP's figure for PBKDF2-SHA256

const b64 = (bytes) => btoa(String.fromCharCode(...bytes))
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

async function keyFor(passphrase, salt, rounds) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

//  {salt, iv, data, rounds}, all JSON-safe.
export async function seal(text, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFor(passphrase, salt, ROUNDS)
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
  return { salt: b64(salt), iv: b64(iv), data: b64(data), rounds: ROUNDS }
}

//  The text, or null for a wrong passphrase (or a damaged seal).
export async function unseal(sealed, passphrase) {
  try {
    const key = await keyFor(passphrase, unb64(sealed.salt), sealed.rounds)
    const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, key, unb64(sealed.data))
    return new TextDecoder().decode(text)
  } catch {
    return null
  }
}
