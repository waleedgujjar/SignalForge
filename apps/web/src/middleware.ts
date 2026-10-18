import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

import { isOnboardingPath, isProtectedPath } from '@/lib/auth-routes';



const SESSION_COOKIE = 'sf_session';



export function middleware(request: NextRequest) {

  const { pathname } = request.nextUrl;

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);



  if (isProtectedPath(pathname) && !hasSession) {

    const loginUrl = new URL('/login', request.url);

    loginUrl.searchParams.set('from', pathname);

    return NextResponse.redirect(loginUrl);

  }



  if (isOnboardingPath(pathname) && !hasSession) {

    return NextResponse.redirect(new URL('/login', request.url));

  }



  return NextResponse.next();

}



export const config = {

  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],

};


