// Session par cookie signé. Web Crypto uniquement : le module est importé par le
// middleware (runtime edge), donc pas de `node:crypto` ici.

export const SESSION_COOKIE = 'wos_session';
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_S = SESSION_DURATION_MS / 1000;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Différence cumulée (XOR) de deux tableaux de même longueur, sans sortie anticipée. */
function xorEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Comparaison à temps constant de deux chaînes. Les deux côtés sont d'abord
 * condensés (HMAC-SHA256 avec une clé aléatoire éphémère) pour que la durée ne
 * dépende ni du contenu ni de la longueur.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const [ha, hb] = await Promise.all([hmac(nonce, a), hmac(nonce, b)]);
  return xorEqual(ha, hb);
}

/** Jeton : `<expiryEpochMs>.<base64url(HMAC-SHA256(secret, expiryEpochMs))>`. */
export async function createSessionToken(secret: string, now: number): Promise<string> {
  if (!secret) throw new Error('SESSION_SECRET manquant');
  const expiry = String(now + SESSION_DURATION_MS);
  return `${expiry}.${toBase64Url(await hmac(secret, expiry))}`;
}

export async function verifySessionToken(
  token: string,
  secret: string,
  now: number,
): Promise<boolean> {
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiry, signature] = parts;
  if (!/^\d{1,16}$/.test(expiry) || !signature) return false;

  const expected = toBase64Url(await hmac(secret, expiry));
  if (!xorEqual(encoder.encode(expected), encoder.encode(signature))) return false;

  const expiresAt = Number(expiry);
  return expiresAt > now && expiresAt - now <= SESSION_DURATION_MS;
}

/** Attributs communs du cookie de session (HttpOnly, Secure, SameSite=Lax). */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;
