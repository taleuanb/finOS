import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_S,
  constantTimeEqual,
  createSessionToken,
} from '@/auth/session';

async function readPassword(request: Request): Promise<string> {
  try {
    if ((request.headers.get('content-type') ?? '').includes('application/json')) {
      const body: unknown = await request.json();
      const value = (body as { password?: unknown } | null)?.password;
      return typeof value === 'string' ? value : '';
    }
    const value = (await request.formData()).get('password');
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Configuration manquante : la variable d'environnement APP_PASSWORD n'est pas définie." },
      { status: 500 },
    );
  }
  if (!secret) {
    return NextResponse.json(
      { error: "Configuration manquante : la variable d'environnement SESSION_SECRET n'est pas définie." },
      { status: 500 },
    );
  }

  const password = await readPassword(request);
  // La comparaison est toujours effectuée (même pour un mot de passe vide) ; un
  // mot de passe vide n'est jamais accepté puisque APP_PASSWORD est non vide.
  const ok = await constantTimeEqual(password, expected);
  if (!ok) {
    return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 });
  }

  const token = await createSessionToken(secret, Date.now());
  const response = NextResponse.redirect(new URL('/', request.url), 303);
  response.cookies.set(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_S });
  return response;
}
