import { NextResponse } from 'next/server';

const SESSION_COOKIE = 'fairsplit_session';

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url));
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    maxAge: 0,
    path: '/',
  });
  return response;
}
