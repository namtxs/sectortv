import { transformMatches } from '$lib/fifa.js';

const API =
  'https://api.fifa.com/api/v3/calendar/matches?language=en&count=500&idSeason=285023';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function load({ fetch, setHeaders }) {
  try {
    const r = await fetch(API, {
      headers: { 'user-agent': UA, accept: 'application/json' }
    });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const j = await r.json();
    const matches = transformMatches(j.Results);
    setHeaders({ 'cache-control': 'public, max-age=120' });
    return { matches, error: false };
  } catch {
    return { matches: [], error: true };
  }
}
