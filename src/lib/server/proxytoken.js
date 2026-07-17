/**
 * Shared signed-token codec for the HLS proxy. XOR-obfuscates the payload
 * ("url\treferer") and appends an HMAC so only tokens WE minted are accepted.
 * Used by the auto pipeline (to mint) and /api/hls (to verify + re-mint).
 */
import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';

const SECRET_KEY = 'stv_9f3ac21e7b_2026';
const SIGN_SECRET = env.PROXY_SECRET || 'stv_proxy_sign_2026';
const DEFAULT_REFERER = 'https://xyzstreams.st/';

export function encodeToken(payload) {
  const data = Buffer.from(payload, 'utf8');
  const key = Buffer.from(SECRET_KEY, 'utf8');
  let out = '';
  for (let i = 0; i < data.length; i++) {
    out += (data[i] ^ key[i % key.length]).toString(16).padStart(2, '0');
  }
  return out;
}

export function decodeToken(hex) {
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return '';
  const key = Buffer.from(SECRET_KEY, 'utf8');
  const bytes = Buffer.alloc(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16) ^ key[i % key.length];
  }
  return bytes.toString('utf8');
}

export function sign(xorHex) {
  return createHmac('sha256', SIGN_SECRET).update(xorHex).digest('hex').slice(0, 32);
}

/** Mint a signed token for a target URL + referer. */
export function pack(url, referer) {
  const x = encodeToken(`${url}\t${referer || DEFAULT_REFERER}`);
  return `${x}.${sign(x)}`;
}

/** Verify + decode a token, or null if invalid. */
export function unpack(token) {
  const dot = (token || '').lastIndexOf('.');
  if (dot < 0) return null;
  const x = token.slice(0, dot);
  const s = token.slice(dot + 1);
  if (s !== sign(x)) return null;
  const payload = decodeToken(x);
  if (!payload) return null;
  const i = payload.indexOf('\t');
  if (i < 0) return { url: payload, referer: DEFAULT_REFERER };
  return { url: payload.slice(0, i), referer: payload.slice(i + 1) || DEFAULT_REFERER };
}
