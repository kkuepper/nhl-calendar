#!/usr/bin/env node
// Fetches NHL schedules with Canadian broadcasters from the public NHL web API
// and writes the files the static site reads:
//
//   site/data/schedule.json  the current season, all 32 teams (refreshed every run)
//   site/data/history.json   the previous HISTORY_SEASONS regular seasons (fetched
//                            once and cached; finished seasons don't change)
//
// The API (api-web.nhle.com) is unofficial and sends no CORS headers, so the
// browser can't call it directly — this script runs at build time instead.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api-web.nhle.com/v1';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEDULE_OUT = join(ROOT, 'site', 'data', 'schedule.json');
const HISTORY_OUT = join(ROOT, 'site', 'data', 'history.json');

// Regular season (2) and playoffs (3). Preseason (1) and exhibition games are skipped.
const GAME_TYPES = new Set([2, 3]);
// Past seasons are compared on regular-season games only.
const HISTORY_GAME_TYPE = 2;
const HISTORY_SEASONS = 4;
// Bump when canadianBroadcasts/normalizeNetwork or the compact format changes,
// so cached seasons are re-fetched with the new transform.
const HISTORY_VERSION = 2;
// Only Canadian broadcasts are kept; the site is about the Canadian TV market.
const COUNTRY = 'CA';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLITE_DELAY_MS = 600; // the API rate-limits bursts
const MAX_ATTEMPTS = 7;

async function getJson(path, attempt = 1) {
  const res = await fetch(`${API}${path}`, { redirect: 'follow' });
  if (!res.ok) {
    if (attempt < MAX_ATTEMPTS && (res.status === 429 || res.status >= 500)) {
      // Honour Retry-After when present, otherwise back off exponentially (2s, 4s, 8s, …).
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      console.warn(`  HTTP ${res.status} for ${path}, retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      return getJson(path, attempt + 1);
    }
    const err = new Error(`HTTP ${res.status} for ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const readJson = (file) => readFile(file, 'utf8').then(JSON.parse).catch(() => null);

// "SN (JIP)" = Sportsnet joined the game in progress; same channel for our purposes.
const normalizeNetwork = (network) => network.replace(/\s*\(JIP\)$/i, '').trim();

function canadianBroadcasts(g) {
  return (g.tvBroadcasts ?? [])
    .filter((b) => b.countryCode === COUNTRY)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((b) => ({ network: normalizeNetwork(b.network), market: b.market }))
    // Normalizing can make "SN" and "SN (JIP)" identical; keep one.
    .filter((b, i, all) => all.findIndex((o) => o.network === b.network && o.market === b.market) === i);
}

function toTeam(s) {
  const abbrev = s.teamAbbrev.default;
  const logo = s.teamLogo || `https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg`;
  return {
    abbrev,
    name: s.teamName.default,
    nameFr: s.teamName.fr ?? s.teamName.default,
    common: s.teamCommonName.default,
    place: s.placeName.default,
    conference: s.conferenceName,
    division: s.divisionName,
    logo,
    logoDark: logo.replace(/_light\.svg$/, '_dark.svg'),
  };
}

function toGame(g) {
  const game = {
    id: g.id,
    type: g.gameType,
    season: g.season,
    date: g.gameDate,
    start: g.startTimeUTC,
    home: g.homeTeam.abbrev,
    away: g.awayTeam.abbrev,
    venue: g.venue?.default ?? null,
    state: g.gameState,
    tv: canadianBroadcasts(g),
  };
  if (g.gameScheduleState && g.gameScheduleState !== 'OK') game.schedule = g.gameScheduleState;
  if (typeof g.homeTeam.score === 'number') {
    game.score = { home: g.homeTeam.score, away: g.awayTeam.score };
  }
  return game;
}

function logNetworks(label, games) {
  const counts = new Map();
  for (const g of games) for (const b of g.tv) counts.set(b.network, (counts.get(b.network) ?? 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}:${c}`).join(' ');
  console.log(`${label} — Canadian networks seen: ${list}`);
}

// ---------------------------------------------------------------- current season

async function updateSchedule(teams) {
  const games = new Map();
  for (const team of teams) {
    const sched = await getJson(`/club-schedule-season/${team.abbrev}/now`);
    let kept = 0;
    for (const g of sched.games ?? []) {
      if (!GAME_TYPES.has(g.gameType)) continue;
      // A game appears in both teams' schedules; the later copy is identical.
      games.set(g.id, toGame(g));
      kept++;
    }
    console.log(`${team.abbrev.padEnd(3)} ${String(kept).padStart(3)} games`);
    await sleep(POLITE_DELAY_MS);
  }

  const sorted = [...games.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  const seasons = [...new Set(sorted.map((g) => g.season))];
  const content = { season: seasons.at(-1) ?? null, country: COUNTRY, teams, games: sorted };

  console.log(`\n${sorted.length} games for ${teams.length} teams`);
  logNetworks('Current season', sorted);

  // Only rewrite the file when the schedule itself changed, so `updatedAt`
  // means "last change" and the scheduled job doesn't commit identical data.
  const previous = await readJson(SCHEDULE_OUT);
  if (previous && JSON.stringify(stripMeta(previous)) === JSON.stringify(content)) {
    console.log(`No changes since ${previous.updatedAt}; ${SCHEDULE_OUT} left as is.`);
  } else {
    await mkdir(dirname(SCHEDULE_OUT), { recursive: true });
    await writeFile(SCHEDULE_OUT, serialize({ updatedAt: new Date().toISOString(), source: API, ...content }));
    console.log(`Wrote ${SCHEDULE_OUT}`);
  }
  return content.season;
}

function stripMeta({ updatedAt, source, ...rest }) {
  return rest;
}

// JSON with one team / game per line: compact, but git diffs stay readable.
function serialize(data) {
  const parts = Object.entries(data).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${JSON.stringify(key)}:[\n${value.map((v) => JSON.stringify(v)).join(',\n')}\n]`;
    }
    return `${JSON.stringify(key)}:${JSON.stringify(value)}`;
  });
  return `{${parts.join(',\n')}}\n`;
}

// ---------------------------------------------------------------- past seasons

/** 20262027 → [20252026, 20242025, …] */
function previousSeasons(season, count) {
  const start = Math.floor(Number(season) / 10000);
  return Array.from({ length: count }, (_, i) => String((start - 1 - i) * 10000 + (start - i)));
}

async function fetchPastSeason(teams, season) {
  const games = new Map();
  for (const team of teams) {
    let sched;
    try {
      sched = await getJson(`/club-schedule-season/${team.abbrev}/${season}`);
    } catch (err) {
      // Teams that didn't exist yet (e.g. Utah before 2024–25) have no schedule.
      if (err.status === 404) {
        console.log(`  ${team.abbrev} ${season}: no schedule`);
        continue;
      }
      throw err;
    }
    for (const g of sched.games ?? []) {
      if (g.gameType !== HISTORY_GAME_TYPE) continue;
      games.set(g.id, { start: g.startTimeUTC, home: g.homeTeam.abbrev, away: g.awayTeam.abbrev, tv: canadianBroadcasts(g) });
    }
    await sleep(POLITE_DELAY_MS);
  }

  // Every team plays the same number of regular-season games. A team with fewer
  // means some schedules came back empty or partial: don't cache the season, so
  // the next run retries it. (A team's own empty response is harmless as long as
  // its opponents' schedules still list all its games.)
  const perTeam = new Map();
  for (const g of games.values()) for (const t of [g.home, g.away]) perTeam.set(t, (perTeam.get(t) ?? 0) + 1);
  const counts = [...perTeam.values()];
  if (!counts.length || Math.min(...counts) !== Math.max(...counts)) {
    const range = counts.length ? `${Math.min(...counts)}–${Math.max(...counts)}` : 'none';
    console.warn(`  ${season}: looks incomplete (games per team: ${range}); not caching it, will retry next run.`);
    return null;
  }

  const sorted = [...games.values()].sort((a, b) => a.start.localeCompare(b.start));
  console.log(`  ${season}: ${sorted.length} games`);
  logNetworks(`  ${season}`, sorted);
  // Compact form: [home, away, ["NETWORK:MARKET", …]]
  return sorted.map((g) => [g.home, g.away, g.tv.map((b) => `${b.network}:${b.market}`)]);
}

async function updateHistory(teams, currentSeason) {
  const wanted = previousSeasons(currentSeason, HISTORY_SEASONS);
  const previous = await readJson(HISTORY_OUT);
  // A cache written by an older transform is discarded and fetched again.
  const current = previous?.version === HISTORY_VERSION;
  const cached = current ? (previous.seasons ?? {}) : {};

  const seasons = {};
  for (const season of wanted) {
    if (cached[season]) {
      seasons[season] = cached[season];
    } else {
      console.log(`\nFetching past season ${season}…`);
      const fetched = await fetchPastSeason(teams, season);
      if (fetched) seasons[season] = fetched;
    }
  }

  const sameSeasons = JSON.stringify(Object.keys(cached).sort()) === JSON.stringify(Object.keys(seasons).sort());
  if (current && sameSeasons) {
    console.log(`Past seasons ${Object.keys(seasons).join(', ')} cached; ${HISTORY_OUT} left as is.`);
    return;
  }

  const body = wanted
    .filter((s) => seasons[s])
    .map((s) => `${JSON.stringify(s)}:[\n${seasons[s].map((g) => JSON.stringify(g)).join(',\n')}\n]`)
    .join(',\n');
  await writeFile(
    HISTORY_OUT,
    `{"version":${HISTORY_VERSION},"format":"[home, away, [\\"NETWORK:MARKET\\", ...]] per regular-season game; markets N/H/A","seasons":{\n${body}\n}}\n`,
  );
  console.log(`Wrote ${HISTORY_OUT}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const standings = await getJson('/standings/now');
  const teams = standings.standings.map(toTeam).sort((a, b) => a.name.localeCompare(b.name));
  if (teams.length < 30) throw new Error(`Expected 32 teams, got ${teams.length}`);

  const season = await updateSchedule(teams);
  if (season) await updateHistory(teams, season);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
