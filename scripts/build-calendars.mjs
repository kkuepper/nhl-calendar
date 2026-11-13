#!/usr/bin/env node
// Builds the iCalendar feeds from site/data/schedule.json:
//
//   site/calendars/{TEAM}.ics                 plain: every game, all Canadian channels
//   site/calendars/{TEAM}/{key}.ics           personalised: games you can't watch start with 🚫
//   site/calendars/{TEAM}/{key}-only.ics      personalised: only games you can watch
//
// {key} encodes a subscription combination (see site/js/feeds.js). Calendar apps
// subscribe to these URLs and pick up changes on their own schedule. Run after
// fetch-data.mjs; the deploy workflow does both.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICES, gameCoverage, viewerMarket } from '../site/js/coverage.js';
import { allFeedSelections, feedPath, plainFeedPath } from '../site/js/feeds.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const DATA = join(SITE, 'data', 'schedule.json');
const OUT_DIR = join(SITE, 'calendars');
const SITE_URL = (process.env.SITE_URL || 'https://kkuepper.github.io/nhl-calendar/').replace(/\/?$/, '/');
const UID_DOMAIN = new URL(SITE_URL).host;
const GAME_HOURS = 3; // puck drop to final horn, roughly, including intermissions
const CANT_WATCH = '🚫';

// ---------------------------------------------------------------- iCalendar helpers (RFC 5545)

const pad = (n) => String(n).padStart(2, '0');

const utcStamp = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

const dateValue = (isoDate) => isoDate.replaceAll('-', '');

function nextDateValue(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

const escapeText = (s) =>
  String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 octets are folded; never split a multi-byte UTF-8 character.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines begin with a space
  }
  return parts.join('\r\n ');
}

// ---------------------------------------------------------------- events

const unique = (list) => [...new Set(list)];
const serviceNames = (ids) => ids.map((id) => SERVICES.find((s) => s.id === id)?.name ?? id);

/**
 * VEVENT lines for one game, or null when the game is left out.
 * `selection` is null for the plain feed, else the subscriptions the feed is built for.
 */
function eventLines(game, team, teamsByAbbrev, stamp, selection, mode) {
  const common = (abbrev) => teamsByAbbrev.get(abbrev)?.common ?? abbrev;
  const teamPage = `${SITE_URL}team.html?team=${team.abbrev}`;
  const cov = gameCoverage(game, viewerMarket('auto', team.abbrev), selection ?? []);
  if (selection && mode === 'only' && !cov.watchable) return null;

  // Channels in the team's own market: national ones plus its regional feed.
  const local = unique(cov.broadcasts.filter((b) => !b.blackedOut).map((b) => b.name));
  const allChannels = local.length
    ? local.join(', ')
    : cov.broadcasts.length
      ? `${unique(cov.broadcasts.map((b) => b.name)).join(', ')} (regional)`
      : 'no Canadian TV';

  // Personalised and watchable: name the channel(s) you'd actually use.
  const yours = cov.outOfMarket
    ? ['Sportsnet+ Premium']
    : unique(cov.broadcasts.filter((b) => b.mine).map((b) => b.name));
  const channels = selection && cov.watchable ? yours.join(', ') : allChannels;

  let summary = `${common(game.away)} @ ${common(game.home)} · ${channels}`;
  if (game.schedule === 'PPD') summary = `POSTPONED: ${summary}`;
  if (game.schedule === 'TBD') summary += ' (time TBD)';
  if (selection && !cov.watchable) summary = `${CANT_WATCH} ${summary}`;

  const description = [];
  if (selection) {
    description.push(
      cov.watchable ? `✅ On your subscriptions: ${yours.join(', ')}` : `${CANT_WATCH} Not on your subscriptions`,
      '',
    );
  }
  description.push('Canadian TV:');
  if (!cov.broadcasts.length) description.push('• none listed yet');
  for (const b of cov.broadcasts) {
    description.push(`• ${b.name} (${b.region ? `${common(b.region)} region only` : 'national'})`);
  }

  const lines = ['BEGIN:VEVENT', `UID:nhl-${game.id}@${UID_DOMAIN}`, `DTSTAMP:${stamp}`];
  if (game.schedule === 'TBD') {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(game.date)}`, `DTEND;VALUE=DATE:${nextDateValue(game.date)}`);
  } else {
    const start = new Date(game.start);
    const end = new Date(start.getTime() + GAME_HOURS * 3600 * 1000);
    lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
  }
  lines.push(
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description.join('\n'))}`,
    ...(game.venue ? [`LOCATION:${escapeText(game.venue)}`] : []),
    `URL:${teamPage}`,
    `STATUS:${game.schedule === 'PPD' ? 'TENTATIVE' : 'CONFIRMED'}`,
    'TRANSP:TRANSPARENT', // don't mark the subscriber as busy
    'END:VEVENT',
  );
  return lines;
}

function calendar(team, games, teamsByAbbrev, stamp, selection = null, mode = 'mark') {
  const teamPage = `${SITE_URL}team.html?team=${team.abbrev}`;
  const subs = selection?.length ? serviceNames(selection).join(', ') : 'no subscriptions';
  const name = selection && mode === 'only' ? `${team.name} · games you can watch` : `${team.name} · Canadian TV`;
  const desc = !selection
    ? `${team.name} games with their Canadian TV channels. See which ones your subscriptions cover: ${teamPage}`
    : `${team.name} games for: ${subs} (watching from the team's home market). ` +
      (mode === 'only' ? 'Games you can’t watch are left out. ' : `${CANT_WATCH} = not on these subscriptions. `) +
      `Different subscriptions? Get another feed at ${teamPage}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//nhl-calendar//NHL on Canadian TV//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-CALDESC:${escapeText(desc)}`,
    // Hints only: Apple honours them, Google refreshes on its own schedule.
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const game of games) {
    const event = eventLines(game, team, teamsByAbbrev, stamp, selection, mode);
    if (event) lines.push(...event);
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------- main

async function main() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const teamsByAbbrev = new Map(data.teams.map((t) => [t.abbrev, t]));
  // DTSTAMP = when the schedule last changed, so unchanged data gives identical files.
  const stamp = utcStamp(new Date(data.updatedAt ?? Date.now()));

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  let files = 0;
  let bytes = 0;
  const write = async (relPath, content) => {
    await mkdir(dirname(join(SITE, relPath)), { recursive: true });
    await writeFile(join(SITE, relPath), content);
    files++;
    bytes += Buffer.byteLength(content);
  };

  for (const team of data.teams) {
    const games = data.games.filter((g) => g.home === team.abbrev || g.away === team.abbrev);
    await write(plainFeedPath(team.abbrev), calendar(team, games, teamsByAbbrev, stamp));
    for (const selection of allFeedSelections(team.abbrev)) {
      for (const mode of ['mark', 'only']) {
        await write(feedPath(team.abbrev, selection, mode), calendar(team, games, teamsByAbbrev, stamp, selection, mode));
      }
    }
  }
  console.log(`Wrote ${files} calendars (${(bytes / 1e6).toFixed(1)} MB) to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
