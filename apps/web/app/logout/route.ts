import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../lib/session';

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url));
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    maxAge: 0,
    path: '/',
  });
  return response;
}
