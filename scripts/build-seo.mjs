#!/usr/bin/env node
// Writes the files crawlers request, from site/data/schedule.json:
//
//   site/sitemap.xml
//   site/robots.txt
//   site/team/<ABBREV>/index.html    one prerendered page per team
//
// Also fills the <!-- seo:jsonld --> and <!-- seo:teams --> markers in
// site/index.html. Run after fetch-data.mjs. The deploy workflow does both.
//
// GitHub Pages project sites serve this robots.txt at /nhl-calendar/robots.txt.
// They cannot replace https://kkuepper.github.io/robots.txt.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUpcoming } from '../site/js/coverage.js';
import {
  channelLabel,
  homeJsonLd,
  teamDescription,
  teamJsonLd,
  teamTitle,
  teamUrl,
  upcomingGames,
} from '../site/js/seo.js';
import { esc, logoHtml, seasonLabel, teamColorStyle } from '../site/js/ui.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const SITE_URL = 'https://kkuepper.github.io/nhl-calendar/';
const VERIFY = '<meta name="google-site-verification" content="QXpKezsz6wlyEP-Tw1eoV5ghvLyqrHnl01e-_Mbq1sw" />';
const EASTERN = 'America/Toronto';

const DIVISIONS = [
  { name: 'Atlantic', conference: 'Eastern' },
  { name: 'Metropolitan', conference: 'Eastern' },
  { name: 'Central', conference: 'Western' },
  { name: 'Pacific', conference: 'Western' },
];

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: EASTERN,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: EASTERN,
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});
const monthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN, month: 'long', year: 'numeric' });

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function replaceMarked(html, name, content) {
  const start = `<!-- seo:${name} -->`;
  const end = `<!-- /seo:${name} -->`;
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  if (from < 0 || to < 0 || to < from) throw new Error(`index.html is missing the ${start} marker`);
  return `${html.slice(0, from + start.length)}\n${content}\n${html.slice(to)}`;
}

function teamDirectory(teams) {
  const known = new Set(DIVISIONS.map((d) => d.name));
  const divisions = [...DIVISIONS];
  for (const team of teams) {
    if (!known.has(team.division)) {
      known.add(team.division);
      divisions.push({ name: team.division, conference: team.conference });
    }
  }
  return divisions
    .map((division) => {
      const cards = teams
        .filter((team) => team.division === division.name)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (team) => `
    <a class="team-card" href="team/${esc(team.abbrev)}/" style="${teamColorStyle(team.abbrev)}">
      ${logoHtml(team, { size: 48, className: 'team-card-logo' })}
      <span class="team-card-name">
        <span class="team-card-place">${esc(team.place)}</span>
        <strong>${esc(team.common)}</strong>
        <small class="team-card-detail">${esc(team.name)} schedule</small>
      </span>
    </a>`,
        )
        .join('');
      return `
      <section class="division" aria-labelledby="div-${esc(division.name)}">
        <h2 class="division-title" id="div-${esc(division.name)}">
          ${esc(division.name)} <span>${esc(division.conference)} Conference</span>
        </h2>
        <div class="team-grid">${cards}</div>
      </section>`;
    })
    .join('');
}

function gamesHtml(team, games, teamsByAbbrev) {
  const upcoming = upcomingGames(games, team.abbrev);
  if (!upcoming.length) {
    return `<h2 id="games-title" class="section-title">Upcoming games</h2>
      <p class="muted">No upcoming ${esc(team.name)} games are listed right now.</p>`;
  }
  const items = [];
  let lastMonth = '';
  for (const game of upcoming) {
    const start = new Date(game.start);
    const month = monthFmt.format(start);
    if (month !== lastMonth) {
      items.push(`<li class="month">${esc(month)}</li>`);
      lastMonth = month;
    }
    const home = game.home === team.abbrev;
    const oppAbbrev = home ? game.away : game.home;
    const opp = teamsByAbbrev.get(oppAbbrev) ?? { abbrev: oppAbbrev, name: oppAbbrev, logo: '', logoDark: '' };
    const channels = (game.tv ?? []).map(channelLabel);
    const tv = channels.length
      ? channels.map((name) => `<li class="tv"><span class="tv-name">${esc(name)}</span></li>`).join('')
      : '<li class="tv tv-none">No Canadian TV listing</li>';
    items.push(`
    <li class="game">
      <div class="game-when">
        <span class="game-date">${esc(dateFmt.format(start))}</span>
        <span class="game-time">${game.schedule === 'TBD' ? 'Time TBD' : esc(timeFmt.format(start))}</span>
      </div>
      <div class="game-match">
        <span class="game-ha">${home ? 'vs' : '@'}</span>
        ${opp.logo ? logoHtml(opp, { size: 32, className: 'game-logo' }) : ''}
        <span class="game-opp">
          <span class="game-opp-name">${esc(opp.name)}</span>
          ${game.venue ? `<span class="game-venue">${esc(game.venue)}</span>` : ''}
        </span>
      </div>
      <ul class="game-tv" aria-label="Canadian broadcasts">${tv}</ul>
    </li>`);
  }
  return `
    <div class="games-head">
      <h2 id="games-title" class="section-title">Upcoming games</h2>
      <p class="muted small">Times in Eastern Time. The page switches them to your time zone.</p>
    </div>
    <ol class="game-list">${items.join('')}</ol>`;
}

function teamPage(team, data, teamsByAbbrev, writeKey) {
  const title = teamTitle(team);
  const description = teamDescription(team);
  const url = teamUrl(team.abbrev);
  const season = seasonLabel(data.season);
  const json = jsonForHtml(teamJsonLd(team, data.games, teamsByAbbrev));
  const upcomingCount = data.games.filter(
    (game) => (game.home === team.abbrev || game.away === team.abbrev) && isUpcoming(game),
  ).length;
  return `<!doctype html>
<html lang="en-CA">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  ${VERIFY}
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="NHL on Canadian TV">
  <meta property="og:locale" content="en_CA">
  ${team.logo ? `<meta property="og:image" content="${esc(team.logo)}">` : ''}
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <link rel="icon" href="../../favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../../css/styles.css">
  <script type="application/ld+json" id="seo-jsonld">${json}</script>
  <script async src="https://analytics.palmeta.net/a.js" data-write-key="${esc(writeKey)}"></script>
  <script type="module" src="../../js/team.js"></script>
</head>
<body>
  <header class="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="../../">
        <img src="../../favicon.svg" alt="" width="26" height="26">
        <span>NHL on Canadian TV</span>
      </a>
      <a class="topbar-link" href="../../">All teams</a>
    </div>
  </header>

  <div id="hero" class="hero" style="${teamColorStyle(team.abbrev)}">
    <div class="wrap hero-inner">
      <div class="hero-logo"><img src="${esc(team.logo)}" alt="" width="88" height="88"></div>
      <div>
        <p class="hero-eyebrow">${esc(team.division)} Division${season ? ` · ${esc(season)}` : ''}</p>
        <h1 class="hero-title">${esc(team.name)} schedule</h1>
        <p class="hero-eyebrow">${esc(String(upcomingCount))} upcoming games on Canadian TV — Sportsnet, TSN, RDS, TVA Sports, and Prime Video.</p>
      </div>
    </div>
  </div>

  <main class="wrap team-main">
    <section class="prefs card" id="prefs" aria-label="Your subscriptions"></section>
    <section id="coverage" class="card coverage" aria-live="polite"></section>
    <section id="history" class="card history" aria-labelledby="history-title" hidden></section>
    <section id="calendar" class="card calendar" aria-labelledby="calendar-title" hidden></section>
    <section id="games" class="games" aria-labelledby="games-title">
      ${gamesHtml(team, data.games, teamsByAbbrev)}
    </section>
  </main>

  <footer class="footer">
    <div class="wrap">
      <p>Schedule and broadcasters from the NHL's public web API, refreshed daily. <span id="updated"></span></p>
      <p>The mapping from channels to subscriptions is maintained by hand and can be wrong — regional blackout rules are simplified. Not affiliated with the NHL; team names and logos are trademarks of the NHL and its teams.</p>
    </div>
  </footer>
</body>
</html>
`;
}

function sitemap(teams, lastmod) {
  const urls = [SITE_URL, ...teams.map((team) => teamUrl(team.abbrev))];
  const body = urls
    .map(
      (loc) => `  <url>
    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

const robots = `# GitHub Pages project sites cannot publish a robots.txt at the domain root
# (https://kkuepper.github.io/robots.txt). This file is served at
# ${SITE_URL}robots.txt. Submit the sitemap in Google Search Console.
User-agent: *
Allow: /

Sitemap: ${SITE_URL}sitemap.xml
`;

const indexHtml = await readFile(join(SITE, 'index.html'), 'utf8');
const keyMatch = indexHtml.match(/data-write-key="([A-Za-z0-9_-]{22})"/);
if (!keyMatch) throw new Error('site/index.html is missing the analytics write key');
const writeKey = keyMatch[1];

const data = JSON.parse(await readFile(join(SITE, 'data', 'schedule.json'), 'utf8'));
const teams = data.teams;
const teamsByAbbrev = new Map(teams.map((team) => [team.abbrev, team]));
const lastmod = typeof data.updatedAt === 'string' ? data.updatedAt.slice(0, 10) : '';

let home = indexHtml;
home = replaceMarked(home, 'jsonld', `<script type="application/ld+json" id="seo-jsonld">${jsonForHtml(homeJsonLd(teams))}</script>`);
home = replaceMarked(home, 'teams', teamDirectory(teams));
if (!home.includes(VERIFY)) throw new Error('index.html is missing the Search Console verification tag');
if (!home.includes(`data-write-key="${writeKey}"`)) throw new Error('index.html lost the analytics snippet');
await writeFile(join(SITE, 'index.html'), home);

await rm(join(SITE, 'team'), { recursive: true, force: true });
for (const team of teams) {
  const dir = join(SITE, 'team', team.abbrev);
  await mkdir(dir, { recursive: true });
  const html = teamPage(team, data, teamsByAbbrev, writeKey);
  if (!html.includes(VERIFY)) throw new Error(`${team.abbrev} page is missing the verification tag`);
  if (!html.includes('application/ld+json')) throw new Error(`${team.abbrev} page is missing JSON-LD`);
  await writeFile(join(dir, 'index.html'), html);
}

await writeFile(join(SITE, 'sitemap.xml'), sitemap(teams, lastmod));
await writeFile(join(SITE, 'robots.txt'), robots);

console.log(`SEO: ${teams.length} team pages, sitemap ${lastmod || 'without lastmod'}`);
