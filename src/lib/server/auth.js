/**
 * Minimal admin auth: a single password (env ADMIN_PASSWORD) exchanged for an
 * httpOnly session cookie. Good enough for a small private admin panel.
 */
import { createHash } from 'node:crypto';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

const COOKIE = 'sv_admin';
const PASSWORD = env.ADMIN_PASSWORD || 'admin123';
const SECRET = env.ADMIN_SECRET || `${PASSWORD}::sectortv-admin`;

function token() {
  return createHash('sha256').update(SECRET).digest('hex');
}

export function checkPassword(pw) {
  return typeof pw === 'string' && pw.length > 0 && pw === PASSWORD;
}

export function isAuthed(cookies) {
  return cookies.get(COOKIE) === token();
}

export function login(cookies) {
  cookies.set(COOKIE, token(), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev, // only over HTTPS in production; allow http://localhost in dev
    maxAge: 60 * 60 * 24 * 30
  });
}

export function logout(cookies) {
  cookies.delete(COOKIE, { path: '/' });
}

/** True while the default password is still in use (show a warning). */
export function usingDefaultPassword() {
  return !env.ADMIN_PASSWORD;
}
