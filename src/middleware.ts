import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, constantTimeEqual, verifySessionToken } from '@/auth/session';

const PUBLIC_EXACT = new Set(['/login', '/api/login', '/favicon.ico', '/icon.png', '/apple-icon.png']);

function isPublic(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || pathname.startsWith('/_next/');
}

/** `/api/sync` accepte aussi `Authorization: Bearer <CRON_SECRET>` (cron Vercel). */
async function hasValidCronBearer(request: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  return constantTimeEqual(match[1], cronSecret);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (pathname === '/api/sync' && (await hasValidCronBearer(request))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  if (token && secret && (await verifySessionToken(token, secret, Date.now()))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Tout sauf les ressources statiques de Next.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
