#!/usr/bin/env node
// Writes the files crawlers request, from site/data/schedule.json:
//
//   site/sitemap.xml
//   site/robots.txt
//   site/team/<ABBREV>/index.html    one prerendered page per team
//   site/how-to/index.html           calendar subscribe guide + Canadian TV primer
//
// Also fills the <!-- seo:jsonld -->, <!-- seo:tonight --> and <!-- seo:teams -->
// markers in site/index.html. Run after fetch-data.mjs. The deploy workflow does both.
//
// Titles, descriptions, and the "what channel is the game on" answers depend on
// the date: they name today's game (Eastern Time) or the next one. The deploy
// workflow rebuilds several times a day so they stay current. Set SEO_NOW to an
// ISO timestamp to build the pages as of another moment.
//
// GitHub Pages project sites serve this robots.txt at /nhl-calendar/robots.txt.
// They cannot replace https://kkuepper.github.io/robots.txt.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUpcoming, networkName, viewerMarket } from '../site/js/coverage.js';
import {
  HOWTO_URL,
  NATIONAL_TV_2026,
  calendarCardHtml,
  channelChipsHtml,
  channelLabel,
  easternDateKey,
  easternLongDate,
  easternShortDate,
  easternStamp,
  easternTime,
  faqJsonLd,
  feedLinks,
  gameChannels,
  homeJsonLd,
  regionalCodes,
  regionalTvParagraphs,
  seasonChannelCounts,
  spotlightGame,
  spotlightSentence,
  teamDescription,
  teamFaq,
  teamJsonLd,
  teamNickname,
  teamTitle,
  teamUrl,
  upcomingGames,
  viewingNote,
} from '../site/js/seo.js';
import { esc, logoHtml, seasonLabel, teamColorStyle } from '../site/js/ui.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const SITE_URL = 'https://kkuepper.github.io/nhl-calendar/';
const VERIFY = '<meta name="google-site-verification" content="QXpKezsz6wlyEP-Tw1eoV5ghvLyqrHnl01e-_Mbq1sw" />';
const EASTERN = 'America/Toronto';

const NOW = process.env.SEO_NOW ? Date.parse(process.env.SEO_NOW) : Date.now();
if (Number.isNaN(NOW)) throw new Error(`SEO_NOW is not a date: ${process.env.SEO_NOW}`);

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

const timeTag = (iso) => `<time datetime="${esc(new Date(iso).toISOString())}">${esc(easternStamp(iso))}</time>`;

/** <head> tags shared by the generated pages. `base` is the path back to the site root. */
function headHtml({ title, description, url, base, image, jsonld, writeKey, script }) {
  return `<meta charset="utf-8">
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
  ${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${base}css/styles.css">
  ${jsonld.map(({ id, value }) => `<script type="application/ld+json" id="${id}">${jsonForHtml(value)}</script>`).join('\n  ')}
  <script async src="https://analytics.palmeta.net/a.js" data-write-key="${esc(writeKey)}"></script>
  ${script ? `<script type="module" src="${base}${script}"></script>` : ''}`;
}

function topbarHtml(base, link = 'All teams') {
  return `<header class="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="${base}">
        <img src="${base}favicon.svg" alt="" width="26" height="26">
        <span>NHL on Canadian TV</span>
      </a>
      <a class="topbar-link" href="${base}">${esc(link)}</a>
    </div>
  </header>`;
}

function footerHtml(base, data) {
  return `<footer class="footer">
    <div class="wrap">
      <p>Schedule and broadcasters from the NHL's public web API, checked several times a day. Page built ${timeTag(NOW)}. <span id="updated">${data.updatedAt ? `Last change: ${esc(easternStamp(data.updatedAt))}.` : ''}</span></p>
      <p>The mapping from channels to subscriptions is maintained by hand and can be wrong — regional blackout rules are simplified. Not affiliated with the NHL; team names and logos are trademarks of the NHL and its teams.</p>
      <p><a href="${base}how-to/">How to subscribe in Google Calendar, Apple Calendar, or Outlook</a> · Spot a wrong count or want a feature? <a id="feedback" href="https://github.com/kkuepper/nhl-calendar/issues/new?template=feedback.yml" target="_blank" rel="noopener">Tell us</a>.</p>
    </div>
  </footer>`;
}

// ---------------------------------------------------------------- home page

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

/**
 * Today's games (Eastern date) with their Canadian channels. When there are none,
 * the next date that has games.
 */
function slate(games, now) {
  const today = easternDateKey(now);
  const todays = games.filter((g) => easternDateKey(g.start) === today);
  if (todays.length) return { today: true, key: today, games: todays };
  const next = games
    .filter((g) => isUpcoming(g, now))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))[0];
  if (!next) return null;
  const key = easternDateKey(next.start);
  return { today: false, key, games: games.filter((g) => easternDateKey(g.start) === key) };
}

function teamLink(abbrev, teamsByAbbrev) {
  const team = teamsByAbbrev.get(abbrev);
  return team ? `<a href="team/${esc(abbrev)}/">${esc(team.name)}</a>` : esc(abbrev);
}

function tonightHtml(data, teamsByAbbrev) {
  const day = slate(data.games, NOW);
  if (!day) {
    return `
    <section class="tonight" aria-labelledby="tonight-title">
      <h2 id="tonight-title" class="section-title">Tonight on Canadian TV</h2>
      <p class="muted">No NHL games are scheduled right now. Checked ${timeTag(NOW)}.</p>
    </section>`;
  }
  const sorted = [...day.games].sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.home.localeCompare(b.home));
  const dateText = easternLongDate(`${day.key}T17:00:00Z`);
  const onTv = sorted.filter((g) => gameChannels(g).length).length;
  const items = sorted
    .map((game) => {
      const done = !isUpcoming(game, NOW);
      const badge = game.state === 'OFF' || game.state === 'FINAL' ? ' <span class="badge badge-warn">Final</span>' : '';
      return `
      <li class="game game-slate${done ? ' game-off' : ''}">
        <div class="game-when">
          <span class="game-date">${esc(easternTime(game).replace(/ ET$/, ''))}</span>
          <span class="game-time">Eastern Time${badge}</span>
        </div>
        <div class="game-match">
          <span class="slate-teams">${teamLink(game.away, teamsByAbbrev)} <span class="muted">at</span> ${teamLink(game.home, teamsByAbbrev)}</span>
        </div>
        <ul class="game-tv" aria-label="Canadian broadcasts">${channelChipsHtml(game)}</ul>
      </li>`;
    })
    .join('');

  const ott = teamsByAbbrev.get('OTT');
  const sens = ott ? spotlightGame(data.games, 'OTT', NOW) : null;
  const teaser = sens
    ? `<p class="slate-teaser">Senators fans: ${esc(spotlightSentence(ott, sens, teamsByAbbrev))} <a href="team/OTT/">Sens TV schedule</a>.</p>`
    : '';

  const heading = day.today ? `Tonight on Canadian TV · ${dateText}` : `Next NHL games on Canadian TV · ${dateText}`;
  const lead = day.today
    ? `${sorted.length} NHL game${sorted.length === 1 ? '' : 's'} today, ${onTv} on Canadian TV. What channel each game is on — Sportsnet, TSN, RDS, TVA Sports, Prime Video, or Sportsnet+ — with regional broadcasts labelled.`
    : `No NHL games today (${easternLongDate(NOW)}). The next slate is ${dateText}, with ${sorted.length} game${sorted.length === 1 ? '' : 's'}.`;
  return `
    <section class="tonight" aria-labelledby="tonight-title">
      <div class="games-head">
        <h2 id="tonight-title" class="section-title">${esc(heading)}</h2>
        <p class="muted small">Times in Eastern Time · checked ${timeTag(NOW)}</p>
      </div>
      <p class="tonight-lead">${esc(lead)}</p>
      <ol class="game-list">${items}</ol>
      ${teaser}
    </section>`;
}

// ---------------------------------------------------------------- team pages

function gamesHtml(team, games, teamsByAbbrev) {
  const upcoming = upcomingGames(games, team.abbrev, NOW);
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

/** The answer to "what channel is the game on", at the top of the page. */
function nextGameHtml(team, data, teamsByAbbrev) {
  const spot = spotlightGame(data.games, team.abbrev, NOW);
  const season = seasonLabel(data.season);
  const checked = `<p class="next-checked muted small">Checked ${timeTag(NOW)} against the NHL schedule. Broadcasters can change on short notice.</p>`;
  if (!spot) {
    return `
      <p class="next-eyebrow">${esc(season)} season</p>
      <h2 class="next-title" id="next-game-title">No upcoming ${esc(team.common)} games</h2>
      <p class="next-answer">The ${esc(team.name)} have no games left on the ${esc(season || 'current')} schedule. The TV schedule below fills in when the NHL publishes the next one.</p>
      ${checked}`;
  }
  const { game } = spot;
  const home = game.home === team.abbrev;
  const opp = teamsByAbbrev.get(home ? game.away : game.home);
  const label = spot.today ? 'Today' : spot.tomorrow ? 'Tomorrow' : 'Next game';
  const question = spot.today
    ? `What channel is the ${team.common} game on today?`
    : `What channel is the next ${team.common} game on?`;
  return `
      <p class="next-eyebrow">${esc(label)} · ${esc(easternLongDate(game.start))}</p>
      <h2 class="next-title" id="next-game-title">${esc(question)}</h2>
      <div class="next-row">
        <div class="game-when">
          <span class="game-date">${esc(easternShortDate(game.start))}</span>
          <span class="game-time">${esc(easternTime(game))}</span>
        </div>
        <div class="game-match">
          <span class="game-ha">${home ? 'vs' : '@'}</span>
          ${opp?.logo ? logoHtml(opp, { size: 32, className: 'game-logo' }) : ''}
          <span class="game-opp">
            <span class="game-opp-name">${esc(opp?.name ?? (home ? game.away : game.home))}</span>
            ${game.venue ? `<span class="game-venue">${esc(game.venue)}</span>` : ''}
          </span>
        </div>
        <ul class="game-tv" aria-label="Canadian broadcasts">${channelChipsHtml(game)}</ul>
      </div>
      <p class="next-answer">${esc(spotlightSentence(team, spot, teamsByAbbrev))}</p>
      <p class="next-note">${esc(viewingNote(team, game))}</p>
      ${checked}`;
}

function tvGuideHtml(team, data) {
  const season = seasonLabel(data.season) || 'this season';
  const counts = seasonChannelCounts(data.games, team.abbrev);
  const rows = counts.rows
    .map(
      (r) => `
          <tr><th scope="row">${esc(r.name)}</th><td>${esc(r.kind)}${r.french ? ', French' : ''}</td><td class="num">${r.count}</td></tr>`,
    )
    .join('');
  const noTv = counts.noTv
    ? `
          <tr><th scope="row">No Canadian TV listing</th><td>–</td><td class="num">${counts.noTv}</td></tr>`
    : '';
  return `
      <h2 class="section-title" id="tv-guide-title">How ${esc(teamNickname(team))} games reach Canadian TV in ${esc(season)}</h2>
      ${regionalTvParagraphs(team, data)
        .map((p) => `<p>${esc(p)}</p>`)
        .join('\n      ')}
      <h3>${esc(season)} ${esc(team.common)} games by channel</h3>
      <table class="breakdown">
        <thead><tr><th scope="col">Channel</th><th scope="col">Type</th><th scope="col" class="num">Games</th></tr></thead>
        <tbody>${rows}${noTv}
        </tbody>
      </table>
      <p class="muted small">All ${counts.total} ${esc(team.name)} games of the ${esc(season)} regular season, played and upcoming. A game can be on more than one channel; other teams’ regional feeds are not counted.</p>`;
}

function faqHtml(team, faq) {
  return `
      <h2 class="section-title" id="faq-title">${esc(team.common)} TV questions</h2>
      ${faq
        .map(
          ({ q, a }) => `
      <div class="faq-item">
        <h3>${esc(q)}</h3>
        <p>${esc(a)}</p>
      </div>`,
        )
        .join('')}`;
}

function teamPage(team, data, teamsByAbbrev, writeKey) {
  const title = teamTitle(team, data, NOW);
  const description = teamDescription(team, data, NOW);
  const url = teamUrl(team.abbrev);
  const season = seasonLabel(data.season);
  const faq = teamFaq(team, data, NOW);
  const upcomingCount = upcomingGames(data.games, team.abbrev, NOW).length;
  return `<!doctype html>
<html lang="en-CA">
<head>
  ${headHtml({
    title,
    description,
    url,
    base: '../../',
    image: team.logo,
    writeKey,
    script: 'js/team.js',
    jsonld: [
      { id: 'seo-jsonld', value: teamJsonLd(team, data, NOW) },
      { id: 'seo-faq', value: faqJsonLd(faq, url) },
    ],
  })}
</head>
<body>
  ${topbarHtml('../../')}

  <div id="hero" class="hero" style="${teamColorStyle(team.abbrev)}">
    <div class="wrap hero-inner">
      <div class="hero-logo"><img src="${esc(team.logo)}" alt="" width="88" height="88"></div>
      <div>
        <p class="hero-eyebrow">${esc(team.division)} Division${season ? ` · ${esc(season)}` : ''}</p>
        <h1 class="hero-title">${esc(team.name)} TV schedule</h1>
        <p class="hero-eyebrow">${esc(String(upcomingCount))} upcoming games · what channel each one is on in Canada</p>
      </div>
    </div>
  </div>

  <main class="wrap team-main">
    <section id="next-game" class="card next-game" aria-labelledby="next-game-title">
      ${nextGameHtml(team, data, teamsByAbbrev)}
    </section>
    <section class="prefs card" id="prefs" aria-label="Your subscriptions"></section>
    <section id="coverage" class="card coverage" aria-live="polite"></section>
    <section id="history" class="card history" aria-labelledby="history-title" hidden></section>
    <section id="calendar" class="card calendar" aria-labelledby="calendar-title">
      ${calendarCardHtml(team)}
    </section>
    <section id="games" class="games" aria-labelledby="games-title">
      ${gamesHtml(team, data.games, teamsByAbbrev)}
    </section>
    <section id="tv-guide" class="prose tv-guide" aria-labelledby="tv-guide-title">
      ${tvGuideHtml(team, data)}
    </section>
    <section id="faq" class="prose faq" aria-labelledby="faq-title">
      ${faqHtml(team, faq)}
    </section>
  </main>

  ${footerHtml('../../', data)}
</body>
</html>
`;
}

// ---------------------------------------------------------------- how-to page

const HOWTO_TITLE = 'How to add NHL games to Google Calendar, Apple Calendar, or Outlook · Canadian TV channels';
const HOWTO_DESCRIPTION =
  'Subscribe to any NHL team’s schedule with the Canadian TV channel in every game: step-by-step for Google Calendar, Apple Calendar, and Outlook, plus who carries the NHL in Canada in 2026–27.';

const HOWTO_STEPS = {
  google: [
    'Open your team’s page on this site and press “Google Calendar”. Google opens with the feed filled in; confirm with “Add”.',
    'Or, in Google Calendar on the web: next to “Other calendars” press +, choose “From URL”, paste the feed URL, and press “Add calendar”.',
    'Google’s phone apps can’t add a calendar by URL, but once added on the web it shows on your phone too. Google refreshes subscribed calendars every few hours, sometimes only once a day.',
  ],
  apple: [
    'On iPhone, iPad, or Mac, open your team’s page and press “Apple Calendar / Outlook”. Calendar asks whether to subscribe; confirm.',
    'Or add it by hand. iPhone and iPad: Settings → Calendar (Settings → Apps → Calendar on newer iOS) → Accounts → Add Account → Other → Add Subscribed Calendar, then paste the feed URL. Mac: in Calendar choose File → New Calendar Subscription and paste the feed URL.',
    'On a Mac, set “Auto-refresh” to every hour or every day so broadcaster changes come through.',
  ],
  outlook: [
    'Outlook on the web, Outlook.com, and the new Outlook for Windows: open Calendar, choose “Add calendar” → “Subscribe from web”, paste the feed URL, give it a name, and press “Import”.',
    'Classic Outlook for Windows: in Calendar choose Home → Add Calendar → From Internet, paste the feed URL, and confirm.',
    'The “Apple Calendar / Outlook” button on a team page opens a webcal:// link, which desktop Outlook can subscribe to directly.',
  ],
};

function howToPage(data, teams, writeKey) {
  const url = HOWTO_URL;
  const season = seasonLabel(data.season) || 'this season';
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
  const example = feedLinks('OTT');
  const feedRows = sorted
    .map((team) => {
      const { feed } = feedLinks(team.abbrev);
      return `
          <tr><th scope="row"><a href="../team/${esc(team.abbrev)}/">${esc(team.name)}</a></th><td><a href="${esc(feed)}">${esc(feed.replace(SITE_URL, ''))}</a></td></tr>`;
    })
    .join('');
  const regional = sorted
    .filter((team) => viewerMarket('auto', team.abbrev))
    .map((team) => {
      const codes = regionalCodes(data.games, team.abbrev).map(([code]) => networkName(code));
      return codes.length ? `<li><a href="../team/${esc(team.abbrev)}/">${esc(team.name)}</a>: ${esc(codes.join(', '))}</li>` : '';
    })
    .filter(Boolean)
    .join('\n          ');
  const steps = (list) => `<ol>${list.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  const jsonld = [
    {
      id: 'seo-jsonld',
      value: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: HOWTO_TITLE,
        description: HOWTO_DESCRIPTION,
        url,
        inLanguage: 'en-CA',
        isPartOf: { '@type': 'WebSite', name: 'NHL on Canadian TV', url: SITE_URL },
        ...(data.updatedAt ? { dateModified: data.updatedAt } : {}),
      },
    },
    {
      id: 'seo-howto',
      value: {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: 'Subscribe to an NHL team schedule with Canadian TV channels',
        description: HOWTO_DESCRIPTION,
        inLanguage: 'en-CA',
        step: [...HOWTO_STEPS.google.slice(0, 2), ...HOWTO_STEPS.apple.slice(0, 2), ...HOWTO_STEPS.outlook.slice(0, 2)].map(
          (text, i) => ({ '@type': 'HowToStep', position: i + 1, text }),
        ),
      },
    },
  ];
  return `<!doctype html>
<html lang="en-CA">
<head>
  ${headHtml({ title: HOWTO_TITLE, description: HOWTO_DESCRIPTION, url, base: '../', writeKey, jsonld })}
</head>
<body>
  ${topbarHtml('../')}

  <main class="wrap">
    <section class="intro">
      <h1>Add NHL games to your calendar, with the Canadian TV channel</h1>
      <p>Every team on this site has a calendar feed (an .ics / iCalendar subscription). Each game shows up with the Canadian channel that carries it — Sportsnet, TSN, RDS, TVA Sports, Prime Video, or Sportsnet+ — and the calendar updates itself when the NHL changes a time or a broadcaster.</p>
    </section>

    <article class="prose howto">
      <h2>1. Find your team’s feed</h2>
      <p>Open your team’s page from the <a href="../">team list</a> and use the calendar buttons on that page. The plain feed lists every game with all its channels; pick your subscriptions on the team page first if you want a personalised feed that marks or leaves out games you can’t watch. Plain feeds look like this: <a href="${esc(example.feed)}">${esc(example.feed)}</a></p>

      <h2>2. Google Calendar</h2>
      ${steps(HOWTO_STEPS.google)}

      <h2>3. Apple Calendar (iPhone, iPad, Mac)</h2>
      ${steps(HOWTO_STEPS.apple)}

      <h2>4. Outlook</h2>
      ${steps(HOWTO_STEPS.outlook)}

      <h2>Who carries the NHL on Canadian TV in ${esc(season)}</h2>
      <ul>
        ${NATIONAL_TV_2026.map((line) => `<li>${esc(line)}</li>`).join('\n        ')}
        <li>TSN and RDS only carry regional games of Canadian teams. Regional broadcasts are blacked out outside the team’s region; Sportsnet also has regional Canucks, Flames, and Oilers games.</li>
      </ul>
      <h3>Regional channels by team this season</h3>
      <ul>
          ${regional}
      </ul>

      <h2>All team feeds</h2>
      <table class="breakdown">
        <thead><tr><th scope="col">Team</th><th scope="col">Plain calendar feed (.ics)</th></tr></thead>
        <tbody>${feedRows}
        </tbody>
      </table>
    </article>
  </main>

  ${footerHtml('../', data)}
</body>
</html>
`;
}

// ---------------------------------------------------------------- sitemap, robots

function sitemap(teams, lastmod) {
  const urls = [SITE_URL, HOWTO_URL, ...teams.map((team) => teamUrl(team.abbrev))];
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

// ---------------------------------------------------------------- build

const indexHtml = await readFile(join(SITE, 'index.html'), 'utf8');
const keyMatch = indexHtml.match(/data-write-key="([A-Za-z0-9_-]{22})"/);
if (!keyMatch) throw new Error('site/index.html is missing the analytics write key');
const writeKey = keyMatch[1];

const data = JSON.parse(await readFile(join(SITE, 'data', 'schedule.json'), 'utf8'));
const teams = data.teams;
const teamsByAbbrev = new Map(teams.map((team) => [team.abbrev, team]));
data.teamsByAbbrev = teamsByAbbrev;
// Pages change with the date (today's game), so lastmod is the build date.
const lastmod = new Date(NOW).toISOString().slice(0, 10);

let home = indexHtml;
home = replaceMarked(home, 'jsonld', `<script type="application/ld+json" id="seo-jsonld">${jsonForHtml(homeJsonLd(teams))}</script>`);
home = replaceMarked(home, 'tonight', tonightHtml(data, teamsByAbbrev));
home = replaceMarked(home, 'teams', teamDirectory(teams));
if (!home.includes(VERIFY)) throw new Error('index.html is missing the Search Console verification tag');
if (!home.includes(`data-write-key="${writeKey}"`)) throw new Error('index.html lost the analytics snippet');
await writeFile(join(SITE, 'index.html'), home);

const checkPage = (name, html) => {
  if (!html.includes(VERIFY)) throw new Error(`${name} is missing the verification tag`);
  if (!html.includes(`data-write-key="${writeKey}"`)) throw new Error(`${name} is missing the analytics snippet`);
  if (!html.includes('application/ld+json')) throw new Error(`${name} is missing JSON-LD`);
};

await rm(join(SITE, 'team'), { recursive: true, force: true });
for (const team of teams) {
  const dir = join(SITE, 'team', team.abbrev);
  await mkdir(dir, { recursive: true });
  const html = teamPage(team, data, teamsByAbbrev, writeKey);
  checkPage(`${team.abbrev} page`, html);
  if (!html.includes('"FAQPage"')) throw new Error(`${team.abbrev} page is missing the FAQ JSON-LD`);
  await writeFile(join(dir, 'index.html'), html);
}

const howTo = howToPage(data, teams, writeKey);
checkPage('how-to page', howTo);
await mkdir(join(SITE, 'how-to'), { recursive: true });
await writeFile(join(SITE, 'how-to', 'index.html'), howTo);

await writeFile(join(SITE, 'sitemap.xml'), sitemap(teams, lastmod));
await writeFile(join(SITE, 'robots.txt'), robots);

console.log(`SEO: ${teams.length} team pages, how-to page, sitemap ${lastmod}, built as of ${easternStamp(NOW)}`);
