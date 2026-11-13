#!/usr/bin/env node
// Fetches the current NHL season for all 32 teams from the public NHL web API
// and writes one compact file the static site reads: site/data/schedule.json.
//
// The API (api-web.nhle.com) is unofficial and sends no CORS headers, so the
// browser can't call it directly — this script runs at build time instead.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api-web.nhle.com/v1';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'data', 'schedule.json');

// Regular season (2) and playoffs (3). Preseason (1) and exhibition games are skipped.
const GAME_TYPES = new Set([2, 3]);
// Only Canadian broadcasts are kept; the site is about the Canadian TV market.
const COUNTRY = 'CA';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    throw new Error(`HTTP ${res.status} for ${path}`);
  }
  return res.json();
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
    tv: (g.tvBroadcasts ?? [])
      .filter((b) => b.countryCode === COUNTRY)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map((b) => ({ network: b.network, market: b.market })),
  };
  if (g.gameScheduleState && g.gameScheduleState !== 'OK') game.schedule = g.gameScheduleState;
  if (typeof g.homeTeam.score === 'number') {
    game.score = { home: g.homeTeam.score, away: g.awayTeam.score };
  }
  return game;
}

async function main() {
  const standings = await getJson('/standings/now');
  const teams = standings.standings.map(toTeam).sort((a, b) => a.name.localeCompare(b.name));
  if (teams.length < 30) throw new Error(`Expected 32 teams, got ${teams.length}`);

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
    await sleep(600); // be polite to the API; it rate-limits bursts
  }

  const sorted = [...games.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  const seasons = [...new Set(sorted.map((g) => g.season))];
  const content = { season: seasons.at(-1) ?? null, country: COUNTRY, teams, games: sorted };

  const networks = new Map();
  for (const g of sorted) for (const b of g.tv) networks.set(b.network, (networks.get(b.network) ?? 0) + 1);
  const list = [...networks].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}:${c}`).join(' ');
  console.log(`\n${sorted.length} games for ${teams.length} teams`);
  console.log(`Canadian networks seen: ${list}`);

  // Only rewrite the file when the schedule itself changed, so `updatedAt`
  // means "last change" and the daily job doesn't commit identical data.
  const previous = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => null);
  if (previous && JSON.stringify(stripMeta(previous)) === JSON.stringify(content)) {
    console.log(`No changes since ${previous.updatedAt}; ${OUT} left as is.`);
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, serialize({ updatedAt: new Date().toISOString(), source: `${API}`, ...content }));
  console.log(`Wrote ${OUT}`);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
