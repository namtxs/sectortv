/**
 * Helpers for the FIFA calendar API
 * (https://api.fifa.com/api/v3/calendar/matches?...&idSeason=285023).
 *
 * Matches whose teams aren't decided yet (knockout TBD / placeholders) are
 * dropped, so only real fixtures with two named teams are returned.
 */

const flagUrl = (code) => (code ? `https://api.fifa.com/api/v3/picture/flags-sq-4/${code}` : null);

function locale(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return (arr.find((x) => x.Locale === 'en-GB') || arr[0]).Description || '';
}

function team(t) {
  if (!t) return null;
  const name = locale(t.TeamName) || t.ShortClubName || '';
  const code = t.IdCountry || t.Abbreviation || '';
  // No real team yet -> placeholder / TBD.
  if (!name || !code) return null;
  return { name, code, flag: flagUrl(code) };
}

/** Map raw FIFA results -> compact match objects, skipping undecided fixtures. */
export function transformMatches(results) {
  return (results || [])
    .map((m) => {
      const home = team(m.Home);
      const away = team(m.Away);
      if (!home || !away) return null;

      const status = m.MatchStatus === 0 ? 'finished' : m.MatchStatus === 1 ? 'upcoming' : 'live';

      return {
        id: m.IdMatch,
        date: m.Date,
        stage: locale(m.StageName),
        group: locale(m.GroupName),
        stadium: locale(m.Stadium?.Name),
        city: locale(m.Stadium?.CityName),
        status,
        home,
        away,
        homeScore: m.HomeTeamScore,
        awayScore: m.AwayTeamScore,
        homePen: m.HomeTeamPenaltyScore,
        awayPen: m.AwayTeamPenaltyScore
      };
    })
    .filter(Boolean);
}

export function dayLabel(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

export function timeLabel(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export function dayKey(iso) {
  return iso ? iso.slice(0, 10) : '';
}

/** Relative day label: "Hari ini" / "Besok" / "Kemarin" / short date. */
export function relDay(iso) {
  if (!iso) return '';
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((startOf(new Date(iso)) - startOf(new Date())) / 86400000);
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Besok';
  if (diff === -1) return 'Kemarin';
  return dayLabel(iso);
}
