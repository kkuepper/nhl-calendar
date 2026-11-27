// Shared copy and structured data for the home page and each team page.
// Used by the browser (team.js) and by scripts/build-seo.mjs.

import { isUpcoming, networkName, viewerMarket } from './coverage.js';
import { plainFeedPath } from './feeds.js';
import { esc, seasonLabel } from './ui.js';

export const SITE_URL = 'https://kkuepper.github.io/nhl-calendar/';

export const HOME_TITLE = 'NHL schedule on Canadian TV · Sportsnet, TSN, TVA Sports';

export const HOME_DESCRIPTION =
  'What channel is tonight’s NHL game on in Canada? Every team’s games and the channels that carry them: Sportsnet, TSN, RDS, TVA Sports, and Prime Video.';

export const HOWTO_URL = `${SITE_URL}how-to/`;

export function teamUrl(abbrev) {
  return `${SITE_URL}team/${abbrev}/`;
}

// ---------------------------------------------------------------- Eastern Time

// Pages are built (and "today" is decided) in Eastern Time, the NHL's
// schedule zone and where most Canadian viewers are.
const EASTERN = 'America/Toronto';
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN, year: 'numeric', month: '2-digit', day: '2-digit' });
const longDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN, weekday: 'long', month: 'long', day: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN, weekday: 'short', month: 'short', day: 'numeric' });
const clockFmt = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN, hour: 'numeric', minute: '2-digit' });
const stampFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: EASTERN,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** YYYY-MM-DD of `date` in Eastern Time. */
export const easternDateKey = (date) => dayKeyFmt.format(new Date(date));
export const easternLongDate = (date) => longDateFmt.format(new Date(date));
export const easternShortDate = (date) => shortDateFmt.format(new Date(date));
/** "Fri, Nov 27, 2026, 9:14 a.m. ET" */
export const easternStamp = (date) => `${stampFmt.format(new Date(date))} ET`;
/** "7:00 p.m. ET", or "time TBD". */
export const easternTime = (game) => (game.schedule === 'TBD' ? 'time TBD' : `${clockFmt.format(new Date(game.start))} ET`);

function nextDayKey(key) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const listFmt = new Intl.ListFormat('en', { type: 'conjunction' });
const andList = (items) => listFmt.format(items);

// ---------------------------------------------------------------- channels

// Stream-only services. Everything else is a TV channel (also streamable with
// the matching app), national or one team's regional feed.
const STREAMING = new Set(['SN+', 'Prime', 'TVAS-D']);
const FRENCH = /^(RDS|TVAS)/;

// How to get each channel, in the words of the subscription picker.
function howToWatch(code) {
  if (code === 'SN+') return 'Sportsnet+';
  if (code === 'Prime') return 'Prime Video';
  if (code.startsWith('TSN')) return 'TSN (TV package or TSN+)';
  if (code.startsWith('RDS')) return 'RDS (TV package or RDS Direct)';
  if (code.startsWith('TVAS')) return 'TVA Sports (TV package or TVA+)';
  if (code.startsWith('SN') || code === 'FX-CA') return 'Sportsnet (TV package or Sportsnet+)';
  return networkName(code);
}

/** A broadcast with its display name, kind (national / regional / streaming), and language. */
export function channelInfo(broadcast, game) {
  const kind = STREAMING.has(broadcast.network) ? 'streaming' : broadcast.market === 'N' ? 'national' : 'regional';
  const region = broadcast.market === 'H' ? game?.home : broadcast.market === 'A' ? game?.away : null;
  return {
    code: broadcast.network,
    name: networkName(broadcast.network),
    kind,
    region,
    french: FRENCH.test(broadcast.network),
    via: howToWatch(broadcast.network),
  };
}

/** Channels of a game, one entry per display name. */
export function gameChannels(game) {
  const seen = new Set();
  const order = { regional: 0, national: 1, streaming: 2 };
  return (game.tv ?? [])
    .map((b) => channelInfo(b, game))
    .filter((c) => !seen.has(c.name) && seen.add(c.name))
    .sort((a, b) => a.french - b.french || order[a.kind] - order[b.kind]);
}

export const channelPhrase = (c) => {
  const lang = c.code === 'Prime' ? ', English and French' : c.french ? ', French' : '';
  return `${c.name} (${c.kind}${lang})`;
};

/** FR tag for French-language channels, and for Prime Video (English and French in Canada). */
const frenchTag = (c) => (c.french || c.code === 'Prime' ? ' · FR' : '');

export function channelLabel(broadcast) {
  const name = networkName(broadcast.network);
  return broadcast.market === 'N' ? name : `${name} (regional)`;
}

/** Chips for a game's channels, with a regional / national / streaming tag. */
export function channelChipsHtml(game) {
  const channels = gameChannels(game);
  if (!channels.length) return '<li class="tv tv-none">No Canadian TV listing</li>';
  return channels
    .map(
      (c) =>
        `<li class="tv"><span class="tv-name">${esc(c.name)}</span><span class="tv-tag">${esc(c.kind)}${frenchTag(c)}</span></li>`,
    )
    .join('');
}

// ---------------------------------------------------------------- the game people search for

// Short names fans type into search boxes.
const NICKNAMES = { OTT: 'Sens', TOR: 'Leafs', MTL: 'Habs' };
export const teamNickname = (team) => NICKNAMES[team.abbrev] ?? team.common;

/**
 * The game "what channel is the game on tonight" is about: the team's next
 * game that hasn't finished. `today` is true when it is on today's Eastern
 * date (including a game in progress); `tomorrow` when it's on the next one.
 */
export function spotlightGame(games, abbrev, now = Date.now()) {
  const game = upcomingGames(games, abbrev, now)[0];
  if (!game) return null;
  const key = easternDateKey(game.start);
  const todayKey = easternDateKey(now);
  return { game, today: key === todayKey, tomorrow: key === nextDayKey(todayKey) };
}

function opponentOf(game, abbrev, teamsByAbbrev) {
  const home = game.home === abbrev;
  const code = home ? game.away : game.home;
  const opp = teamsByAbbrev?.get(code) ?? { abbrev: code, name: code, common: code };
  return { opp, home };
}

/** "at the Tampa Bay Lightning" / "vs the Boston Bruins" */
export function opponentPhrase(game, abbrev, teamsByAbbrev, { short = false } = {}) {
  const { opp, home } = opponentOf(game, abbrev, teamsByAbbrev);
  return `${home ? 'vs' : 'at'} ${short ? opp.common : `the ${opp.name}`}`;
}

function dayWord(spot) {
  if (spot.today) return 'today';
  if (spot.tomorrow) return 'tomorrow';
  return `on ${easternLongDate(spot.game.start)}`;
}

/**
 * One or two sentences answering "what channel is the game on":
 * "Today (Friday, November 27) the Ottawa Senators play at the Tampa Bay
 *  Lightning at 3:00 p.m. ET. In Canada the game is on TSN5 (regional) and RDS (regional, French)."
 */
export function spotlightSentence(team, spot, teamsByAbbrev) {
  const { game } = spot;
  const when = spot.today || spot.tomorrow
    ? `${spot.today ? 'Today' : 'Tomorrow'} (${easternLongDate(game.start)})`
    : `Next up, on ${easternLongDate(game.start)},`;
  const opp = opponentPhrase(game, team.abbrev, teamsByAbbrev);
  const timePart = game.schedule === 'TBD' ? '(time to be announced)' : `at ${easternTime(game)}`;
  const channels = gameChannels(game);
  const tv = channels.length
    ? `In Canada the game is on ${andList(channels.map(channelPhrase))}.`
    : 'The game has no Canadian TV broadcast listed.';
  return `${when} the ${team.name} play ${opp} ${timePart}. ${tv}`;
}

/** Who can actually see the spotlight game: regional blackouts and how to get each channel. */
export function viewingNote(team, game) {
  const channels = gameChannels(game);
  if (!channels.length) {
    return `No Canadian channel lists this ${team.common} game. Out-of-market packages such as Sportsnet+ Premium may still carry it.`;
  }
  const regional = channels.filter((c) => c.kind === 'regional');
  const national = channels.filter((c) => c.kind !== 'regional');
  const parts = [];
  if (regional.length) {
    const byRegion = new Map();
    for (const c of regional) byRegion.set(c.region, [...(byRegion.get(c.region) ?? []), c.name]);
    for (const [region, names] of byRegion) {
      const area = viewerMarket('auto', region)?.name;
      parts.push(
        `${andList(names)} ${names.length > 1 ? 'are regional broadcasts' : 'is a regional broadcast'}${area ? `, only available in ${area}` : ''}.`,
      );
    }
    if (!national.length) parts.push('Outside that region the game is not on Canadian TV, though Sportsnet+ Premium’s out-of-market package may carry it.');
  }
  if (national.length) {
    parts.push(`${andList(national.map((c) => c.name))} ${national.length > 1 ? 'are' : 'is'} available across Canada.`);
  }
  const via = [...new Set(channels.map((c) => c.via))];
  parts.push(`To watch you need ${via.length > 1 ? 'one of: ' : ''}${via.join('; ')}.`);
  return parts.join(' ');
}

const TITLE_LIMIT = 65;

function firstTitleWithin(candidates, limit = TITLE_LIMIT) {
  return candidates.find((title) => title.length <= limit) ?? candidates.at(-1);
}

export function teamTitle(team, data, now = Date.now()) {
  const fallback = `${team.name} TV schedule on Canadian TV`;
  const spot = data ? spotlightGame(data.games, team.abbrev, now) : null;
  if (!spot) return data ? fallback : `${team.name} schedule on Canadian TV`;
  const names = gameChannels(spot.game).map((c) => c.name);
  const tv = names.length ? names.join(', ') : 'No Canadian TV listed yet';
  const opp = opponentPhrase(spot.game, team.abbrev, data.teamsByAbbrev, { short: true });
  const time = easternTime(spot.game);
  const date = easternShortDate(spot.game.start);
  // When more than two channels, drop the opponent or the time/date so the title stays short.
  const many = names.length > 2;
  const shortToday = names.length
    ? `${team.common} game today: ${tv}`
    : `${team.common} game today: ${tv}`;
  const shortNext = `Next ${team.common} game: ${tv}`;
  if (spot.today) {
    const q = names.length
      ? `What channel is the ${team.common} game on today?`
      : `Is the ${team.common} game on TV today?`;
    const both = `${q} ${tv} · ${opp}, ${time}`;
    const withTime = `${q} ${tv} · ${time}`;
    const withOpp = `${q} ${tv} · ${opp}`;
    const base = `${q} ${tv}`;
    return firstTitleWithin(many ? [withTime, withOpp, base, shortToday] : [both, withTime, withOpp, base, shortToday]);
  }
  const q = `What channel is the next ${team.common} game on?`;
  const both = `${q} ${tv} · ${date} ${opp}`;
  const withDate = `${q} ${tv} · ${date}`;
  const withOpp = `${q} ${tv} · ${opp}`;
  const base = `${q} ${tv}`;
  return firstTitleWithin(many ? [withDate, withOpp, base, shortNext] : [both, withDate, withOpp, base, shortNext]);
}

function teamChannelSummary(team, data) {
  const top = seasonChannelCounts(data.games, team.abbrev)
    .rows.map((r) => r.brand)
    .filter((b, i, all) => all.indexOf(b) === i)
    .slice(0, 5);
  return top.length ? andList(top) : 'Sportsnet, TSN, RDS, TVA Sports, and Prime Video';
}

const META_LIMIT = 155;

function clipMeta(text, limit = META_LIMIT) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const atWord = cut.replace(/\s+\S*$/, '');
  const trimmed = (atWord.length >= 80 ? atWord : cut).replace(/[ .,;:–-]+$/, '');
  return `${trimmed}…`;
}

export function teamDescription(team, data, now = Date.now()) {
  if (!data) {
    return `Upcoming ${team.name} games and which Canadian channels carry them: Sportsnet, TSN, RDS, TVA Sports, and Prime Video.`;
  }
  const season = seasonLabel(data.season);
  const tail = `${season ? `${season} ` : ''}${team.name} TV schedule.`;
  const spot = spotlightGame(data.games, team.abbrev, now);
  if (!spot) return clipMeta(`No upcoming ${team.name} games are scheduled. ${tail}`);
  const channels = gameChannels(spot.game);
  const when = spot.today ? 'today' : spot.tomorrow ? 'tomorrow' : `on ${easternShortDate(spot.game.start)}`;
  const opp = opponentPhrase(spot.game, team.abbrev, data.teamsByAbbrev, { short: true });
  const time = spot.game.schedule === 'TBD' ? '' : `, ${easternTime(spot.game)}`;
  const lead = channels.length
    ? `${andList(channels.map(channelPhrase))} — ${team.common} ${opp} ${when}${time}.`
    : `No Canadian TV listed yet for the ${team.common} game ${opp} ${when}${time}.`;
  return clipMeta(`${lead} ${tail}`);
}

// ---------------------------------------------------------------- season breakdown

// Channel families, for the "most used channels" summary.
function brandOf(code) {
  if (code.startsWith('TSN')) return 'TSN';
  if (code.startsWith('RDS')) return 'RDS';
  if (code.startsWith('TVAS')) return 'TVA Sports';
  if (code === 'SN+') return 'Sportsnet+';
  if (code === 'Prime') return 'Prime Video';
  if (code.startsWith('SN')) return 'Sportsnet';
  return networkName(code);
}

/**
 * How many of the team's games this season each channel carries. Counts national
 * broadcasts and the team's own regional feeds; the opponent's regional feed is
 * left out, since it isn't shown in this team's region.
 */
export function seasonChannelCounts(games, abbrev) {
  const teamGames = games.filter((g) => g.home === abbrev || g.away === abbrev);
  const counts = new Map();
  let noTv = 0;
  for (const game of teamGames) {
    const own = (game.tv ?? []).filter(
      (b) => b.market === 'N' || (b.market === 'H' ? game.home : game.away) === abbrev,
    );
    if (!own.length) noTv++;
    for (const b of own) {
      const info = channelInfo(b, game);
      const key = `${info.code}:${info.kind}`;
      const row = counts.get(key) ?? { ...info, brand: brandOf(info.code), count: 0 };
      row.count++;
      counts.set(key, row);
    }
  }
  const rows = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { total: teamGames.length, noTv, rows };
}

// ---------------------------------------------------------------- how TV works, per team

/** National rules for 2026–27, shared by every team page and the how-to page. */
export const NATIONAL_TV_2026 = [
  'Sportsnet is the main national English broadcaster, including Saturday nights, when TVA Sports has the French broadcast.',
  'Monday Night Hockey is on Sportsnet+, Rogers’ streaming service.',
  'Wednesday national games are exclusive to Prime Video.',
  'TVA Sports is the national French-language broadcaster.',
  'CBC does not carry NHL games in 2026–27, so no games are on free over-the-air TV.',
];

/** [code, count] of a team's own regional broadcasts this season, most used first. */
export function regionalCodes(games, abbrev) {
  const counts = new Map();
  for (const game of games) {
    for (const b of game.tv ?? []) {
      if (b.market === 'N') continue;
      if ((b.market === 'H' ? game.home : game.away) !== abbrev) continue;
      counts.set(b.network, (counts.get(b.network) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const countList = (entries) => andList(entries.map(([code, n]) => `${networkName(code)} (${n})`));

/**
 * Paragraphs (plain text) explaining how the team's games reach Canadian TV this
 * season. Ottawa, Toronto, and Montréal get hand-written notes; every count
 * comes from the schedule data.
 */
export function regionalTvParagraphs(team, data) {
  const season = seasonLabel(data.season) || 'this season';
  const region = viewerMarket('auto', team.abbrev);
  const regional = regionalCodes(data.games, team.abbrev);
  const paras = [];
  if (team.abbrev === 'OTT') {
    paras.push(
      `The Senators are a split market in ${season}. Their regional games are on TSN5 in English and RDS in French; when RDS is busy the French broadcast moves to RDS2 or RDS Info. Regional broadcasts are only available in ${region.name}, a territory shared with the Canadiens, and are blacked out elsewhere in Canada.`,
      `Everything else is national: Sportsnet (often Sportsnet One or Sportsnet East) on Saturdays and other nights, Sportsnet+ on Monday nights, Prime Video with exclusive Wednesday games, and TVA Sports as the national French broadcaster. CBC does not carry the NHL this season.`,
    );
  } else if (team.abbrev === 'TOR') {
    const tsn4 = regional.find(([code]) => code === 'TSN4')?.[1];
    const sno = regional.find(([code]) => code === 'SNO')?.[1];
    const split =
      tsn4 != null && sno != null
        ? `Most Maple Leafs regional games are on TSN4 (${tsn4} this season), with only ${sno} on Sportsnet Ontario.`
        : 'Most Maple Leafs regional games are on TSN4, with only a few on Sportsnet Ontario.';
    paras.push(
      `${split} Regional games air only in ${region.name} and parts of Northwestern Ontario, and are blacked out in the rest of Canada.`,
      'Most other Leafs games are national on Sportsnet (Saturdays with TVA Sports in French), Sportsnet+ on Monday nights, and Prime Video on Wednesdays. CBC does not carry the NHL this season.',
    );
  } else if (team.abbrev === 'MTL') {
    paras.push(
      `Canadiens regional games are on TSN2 in English and RDS in French, available only in ${region.name} (shared with the Senators). TVA Sports carries the national French games, mostly Saturdays.`,
      'National English games are on Sportsnet, Sportsnet+ on Monday nights, and Prime Video (exclusive Wednesdays). CBC does not carry the NHL this season.',
    );
  } else if (region) {
    paras.push(
      regional.length
        ? `${team.name} regional games are on ${andList(regional.map(([code]) => networkName(code)))}, available only in ${region.name}. Other games are national: Sportsnet, Sportsnet+ on Monday nights, Prime Video (exclusive Wednesdays), and TVA Sports in French.`
        : `${team.name} games air in Canada on national channels: Sportsnet, Sportsnet+, Prime Video, and TVA Sports in French.`,
    );
  } else {
    paras.push(
      `The ${team.name} have no Canadian regional broadcaster, so in Canada their games are only on national channels: Sportsnet, Sportsnet+ on Monday nights, Prime Video (exclusive Wednesdays), and TVA Sports in French. Games without a national broadcast are usually available with Sportsnet+ Premium’s out-of-market package.`,
    );
  }
  if (regional.length) {
    paras.push(`This season’s schedule lists ${team.common} regional broadcasts on ${countList(regional)}.`);
  }
  return paras;
}

// ---------------------------------------------------------------- FAQ

/** Question / answer pairs (plain text) for the team page and its FAQPage JSON-LD. */
export function teamFaq(team, data, now = Date.now()) {
  const nick = teamNickname(team);
  const season = seasonLabel(data.season) || 'this season';
  const spot = spotlightGame(data.games, team.abbrev, now);
  const remaining = upcomingGames(data.games, team.abbrev, now).length;
  const faq = [];

  let tonight;
  let where;
  let televised;
  if (!spot) {
    tonight = `There are no ${team.name} games left on the ${season} schedule.`;
    where = tonight;
    televised = tonight;
  } else {
    const sentence = spotlightSentence(team, spot, data.teamsByAbbrev);
    const channels = gameChannels(spot.game);
    tonight = spot.today
      ? sentence
      : `The ${team.name} don’t play today (${easternLongDate(now)}). ${sentence}`;
    where = `${spot.today ? '' : `There’s no ${team.common} game today. `}${viewingNote(team, spot.game)}`;
    const which = spot.today ? 'Today’s' : 'The next';
    const what = `${which} ${team.common} game ${opponentPhrase(spot.game, team.abbrev, data.teamsByAbbrev)} (${easternShortDate(spot.game.start)}, ${easternTime(spot.game)})`;
    televised = channels.length
      ? `${spot.today ? 'Yes. ' : `There’s no ${team.common} game today. `}${what} is on ${andList(channels.map(channelPhrase))} in Canada.`
      : `${spot.today ? 'No. ' : `There’s no ${team.common} game today. `}${what} has no Canadian TV broadcast listed.`;
  }

  faq.push({ q: `What channel is the ${nick} game on tonight?`, a: tonight });
  faq.push({ q: `Where can I watch the ${team.common} game tonight?`, a: where });
  faq.push({ q: `Is the ${team.name} game televised tonight?`, a: televised });
  faq.push({ q: `How does ${nick} TV work in ${season}?`, a: regionalTvParagraphs(team, data).join(' ') });

  const counts = seasonChannelCounts(data.games, team.abbrev);
  const top = counts.rows.slice(0, 4).map((r) => `${r.name} (${r.count})`);
  faq.push({
    q: `Where can I find the ${team.name} TV schedule?`,
    a: `${remaining ? `This page lists all ${remaining} remaining ${team.name} games with their Canadian channels, in Eastern Time,` : 'This page lists the season’s games with their Canadian channels as soon as the NHL publishes them,'} rebuilt from the NHL schedule several times a day. ${top.length ? `Across all ${counts.total} games of ${season}, the most used channels are ${andList(top)}.` : ''}`.trim(),
  });
  faq.push({
    q: `Can I add the ${team.common} TV schedule to my calendar?`,
    a: `Yes. Subscribe to ${SITE_URL}${plainFeedPath(team.abbrev)} in Google Calendar, Apple Calendar, or Outlook. Every game has its Canadian channels in the title, and the calendar updates itself when broadcasters change.`,
  });
  return faq;
}

export function faqJsonLd(faq, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url,
    inLanguage: 'en-CA',
    mainEntity: faq.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

// ---------------------------------------------------------------- calendar subscribe

/** Plain feed, webcal, Google Calendar, and Outlook subscribe links for a team. */
export function feedLinks(abbrev, root = SITE_URL, label) {
  const feed = new URL(plainFeedPath(abbrev), root).href;
  const webcal = feed.replace(/^https?:/, 'webcal:');
  const title = label ?? `${abbrev} NHL on Canadian TV`;
  const outlookQuery = `url=${encodeURIComponent(feed)}&name=${encodeURIComponent(title)}`;
  return {
    feed,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    live: `https://outlook.live.com/calendar/0/addfromweb?${outlookQuery}`,
    work: `https://outlook.office.com/calendar/0/addfromweb?${outlookQuery}`,
  };
}

/**
 * The "Add the schedule to your calendar" card, with working links to the plain
 * feed. Prerendered into team pages so it is readable without JavaScript;
 * team.js keeps this markup and only repoints the links once subscriptions are picked.
 */
export function calendarCardHtml(team, { howTo = '../../how-to/', root = SITE_URL } = {}) {
  const { feed, webcal, google, live, work } = feedLinks(team.abbrev, root, `${team.name} on Canadian TV`);
  return `
    <div class="calendar-head">
      <h2 class="calendar-title" id="calendar-title">Add the ${esc(team.common)} TV schedule to your calendar</h2>
      <p class="muted small">Every ${esc(team.common)} game this season with its Canadian channel in the title. Subscribe once in Google Calendar, Apple Calendar, or Outlook and your calendar picks up schedule and broadcaster changes by itself. Google checks every few hours, sometimes only once a day. <a href="${esc(howTo)}">How to subscribe, step by step</a>.</p>
    </div>
    <p class="calendar-for">Lists every game with all its channels. Pick your subscriptions above to personalise the feed.</p>
    <fieldset class="calendar-modes" hidden>
      <legend class="sr-only">Games you can’t watch</legend>
      <label><input type="radio" name="calendar-mode" value="mark" checked> Show them, marked 🚫</label>
      <label><input type="radio" name="calendar-mode" value="only"> Leave them out</label>
    </fieldset>
    <div class="calendar-actions">
      <a class="btn btn-primary" data-link="google" href="${esc(google)}" target="_blank" rel="noopener">Google Calendar</a>
      <a class="btn" data-link="webcal" href="${esc(webcal)}">Apple Calendar</a>
      <a class="btn" data-link="live" href="${esc(live)}" target="_blank" rel="noopener">Outlook.com</a>
      <a class="btn" data-link="work" href="${esc(work)}" target="_blank" rel="noopener">Outlook 365</a>
      <a class="btn" data-link="download" href="${esc(feed)}" download="${esc(team.abbrev)}.ics">Download .ics</a>
    </div>
    <div class="calendar-url">
      <label class="calendar-url-label" for="calendar-url">Feed URL for any other calendar app</label>
      <div class="calendar-url-row">
        <input id="calendar-url" type="text" readonly value="${esc(feed)}">
        <button type="button" class="btn calendar-copy">Copy</button>
      </div>
    </div>
    <p class="calendar-plain muted small">Plain ${esc(team.name)} feed (iCalendar / ICS, every game): <a href="${esc(feed)}">${esc(feed)}</a></p>
    <p class="calendar-note muted small" hidden></p>`;
}
export function upcomingGames(games, abbrev, now = Date.now()) {
  return games
    .filter(
      (game) =>
        (game.home === abbrev || game.away === abbrev) &&
        game.schedule !== 'PPD' &&
        game.schedule !== 'CNCL' &&
        isUpcoming(game, now),
    )
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

function sportsTeam(team) {
  return { '@type': 'SportsTeam', name: team.name, sport: 'Ice Hockey' };
}

/**
 * A game's Canadian broadcasts as schema.org BroadcastEvents. They point at the
 * game through broadcastOfEvent, written from the game's side with @reverse.
 */
function broadcastEvents(game) {
  return gameChannels(game).map((c) => {
    const area = c.region ? viewerMarket('auto', c.region)?.name : null;
    return {
      '@type': 'BroadcastEvent',
      name: `${c.name} (${c.kind})`,
      isLiveBroadcast: true,
      startDate: game.start,
      inLanguage: c.french ? 'fr-CA' : 'en-CA',
      publishedOn: {
        '@type': 'BroadcastService',
        name: c.name,
        broadcastDisplayName: c.name,
        areaServed: area ?? 'Canada',
      },
    };
  });
}

export function sportsEvent(game, teamsByAbbrev) {
  const home = teamsByAbbrev.get(game.home);
  const away = teamsByAbbrev.get(game.away);
  const channels = gameChannels(game).map(channelPhrase);
  const event = {
    '@type': 'SportsEvent',
    name: `${away?.name ?? game.away} at ${home?.name ?? game.home}`,
    sport: 'Ice Hockey',
    startDate: game.start,
    eventStatus: 'https://schema.org/EventScheduled',
    homeTeam: sportsTeam(home ?? { name: game.home }),
    awayTeam: sportsTeam(away ?? { name: game.away }),
    description: channels.length ? `Canadian TV: ${channels.join(', ')}` : 'No Canadian TV listing',
  };
  if (game.venue) event.location = { '@type': 'Place', name: game.venue };
  const broadcasts = broadcastEvents(game);
  if (broadcasts.length) event['@reverse'] = { broadcastOfEvent: broadcasts };
  return event;
}

/** WebPage JSON-LD for a team. `data` is schedule.json with a `teamsByAbbrev` map. */
export function teamJsonLd(team, data, now = Date.now()) {
  const upcoming = upcomingGames(data.games, team.abbrev, now);
  const page = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: teamTitle(team, data, now),
    description: teamDescription(team, data, now),
    url: teamUrl(team.abbrev),
    inLanguage: 'en-CA',
    isPartOf: { '@type': 'WebSite', name: 'NHL on Canadian TV', url: SITE_URL },
    about: sportsTeam(team),
    mainEntity: {
      '@type': 'ItemList',
      name: `${team.name} upcoming games on Canadian TV`,
      numberOfItems: upcoming.length,
      itemListElement: upcoming.map((game, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: sportsEvent(game, data.teamsByAbbrev),
      })),
    },
  };
  if (data.updatedAt) page.dateModified = data.updatedAt;
  return page;
}

export function homeJsonLd(teams) {
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'NHL on Canadian TV',
      url: SITE_URL,
      description: HOME_DESCRIPTION,
      inLanguage: 'en-CA',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'NHL teams on Canadian TV',
      numberOfItems: sorted.length,
      itemListElement: sorted.map((team, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: team.name,
        url: teamUrl(team.abbrev),
      })),
    },
  ];
}
