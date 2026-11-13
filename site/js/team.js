import { MARKETS, SERVICES, seasonCoverage, suggestions, teamCoverage } from './coverage.js';
import { feedPath, feedSelection, plainFeedPath } from './feeds.js';
import { teamDescription, teamJsonLd, teamTitle, teamUrl } from './seo.js';
import {
  esc,
  loadData,
  loadHistory,
  loadPrefs,
  logoHtml,
  mountPicker,
  percent,
  pieWithLabel,
  seasonLabel,
  showError,
  teamColorStyle,
  updatedLabel,
} from './ui.js';

const siteRoot = new URL('../', import.meta.url);
const INITIAL_GAMES = 10;
const MAX_PAST_SEASONS = 4;

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Team code from /team/TOR/ or the legacy ?team=TOR query. */
function teamAbbrev() {
  const query = new URLSearchParams(location.search).get('team');
  if (query) return query.toUpperCase();
  const parts = location.pathname.split('/').filter(Boolean);
  const index = parts.lastIndexOf('team');
  const abbrev = index >= 0 ? parts[index + 1] : '';
  return abbrev && /^[A-Za-z]{2,3}$/.test(abbrev) ? abbrev.toUpperCase() : '';
}

function setMeta(name, content, attr = 'name') {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Title, description, canonical, social tags, and SportsEvent JSON-LD. */
function applyTeamMeta(team, data) {
  const title = teamTitle(team);
  const description = teamDescription(team);
  const url = teamUrl(team.abbrev);
  document.title = title;
  setMeta('description', description);
  setMeta('og:title', title, 'property');
  setMeta('og:description', description, 'property');
  setMeta('og:url', url, 'property');
  setMeta('twitter:title', title);
  setMeta('twitter:description', description);
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = url;
  let ld = document.getElementById('seo-jsonld');
  if (!ld) {
    ld = document.createElement('script');
    ld.id = 'seo-jsonld';
    ld.type = 'application/ld+json';
    document.head.appendChild(ld);
  }
  ld.textContent = JSON.stringify(teamJsonLd(team, data.games, data.teamsByAbbrev));
}

async function main() {
  const gamesEl = document.getElementById('games');
  const abbrev = teamAbbrev();

  let data;
  try {
    data = await loadData();
  } catch (err) {
    showError(gamesEl, err.message);
    return;
  }
  if (data.updatedAt) document.getElementById('updated').textContent = `Last change: ${updatedLabel(data.updatedAt)}.`;

  const team = data.teamsByAbbrev.get(abbrev);
  if (!team) {
    document.getElementById('prefs').hidden = true;
    document.getElementById('coverage').hidden = true;
    gamesEl.innerHTML = `<div class="error" role="alert"><strong>Team not found.</strong> <a href="./">Pick a team from the list</a>.</div>`;
    return;
  }

  // Only fetched for a real team; past seasons arrive after the page is usable.
  const historyPromise = loadHistory();
  applyTeamMeta(team, data);
  renderHero(team, data);
  const calendar = mountCalendar(team);

  const state = { prefs: loadPrefs(), expanded: false, history: [] };
  const render = () => {
    const cov = teamCoverage(data.games, team.abbrev, state.prefs);
    renderCoverage(team, data, state.prefs, cov);
    renderHistory(team, state.history, state.prefs);
    calendar.update(state.prefs);
    renderGames(gamesEl, team, data, state, cov, render);
  };

  state.prefs = mountPicker(document.getElementById('prefs'), state.prefs, (next) => {
    state.prefs = next;
    render();
  });
  render();

  state.history = await historyPromise;
  renderHistory(team, state.history, state.prefs);
}

function renderHistory(team, history, prefs) {
  const el = document.getElementById('history');
  const seasons = history
    .map(({ season, games }) => ({ season, cov: seasonCoverage(games, team.abbrev, prefs) }))
    .filter(({ cov }) => cov.total > 0) // e.g. Utah before 2024–25
    .slice(0, MAX_PAST_SEASONS);

  el.hidden = seasons.length === 0;
  if (!seasons.length) return;

  const has = prefs.services.length > 0;
  const items = seasons.map(({ season, cov }) => {
    const label = seasonLabel(season);
    const value = has ? percent(cov.fraction) : '–';
    const detail = has ? `${cov.watchable} of ${cov.total} games` : `${cov.total} games`;
    const aria = has ? `${label}: ${cov.watchable} of ${cov.total} games watchable (${value})` : `${label}: ${cov.total} games`;
    return `
      <li class="history-item" aria-label="${esc(aria)}">
        ${pieWithLabel(has ? cov.fraction : null, value, { size: 92, thickness: 10, className: 'history-pie' })}
        <div class="history-label" aria-hidden="true">
          <strong>${esc(label)}</strong>
          <span>${esc(detail)}</span>
        </div>
      </li>`;
  });

  el.innerHTML = `
    <div class="history-head">
      <h2 class="history-title" id="history-title">Past seasons</h2>
      <p class="muted small">Same subscriptions and region, applied to each full regular season. Until 2025–26, CBC and Citytv carried Saturday games — those count under Free TV.</p>
    </div>
    <ol class="history-list">${items.join('')}</ol>`;
}

/**
 * The "Add to your calendar" card. Feeds are static files built by
 * scripts/build-calendars.mjs, one per subscription combination (see feeds.js);
 * `update(prefs)` points every link at the feed for the current selection.
 */
function mountCalendar(team) {
  const el = document.getElementById('calendar');
  el.innerHTML = `
    <div class="calendar-head">
      <h2 class="calendar-title" id="calendar-title">Add the schedule to your calendar</h2>
      <p class="muted small">Every ${esc(team.common)} game this season with its Canadian channel in the title. Subscribe once and your calendar picks up schedule and broadcaster changes by itself. Google checks every few hours, sometimes only once a day.</p>
    </div>
    <p class="calendar-for"></p>
    <fieldset class="calendar-modes">
      <legend class="sr-only">Games you can’t watch</legend>
      <label><input type="radio" name="calendar-mode" value="mark" checked> Show them, marked 🚫</label>
      <label><input type="radio" name="calendar-mode" value="only"> Leave them out</label>
    </fieldset>
    <div class="calendar-actions">
      <a class="btn btn-primary" data-link="google" target="_blank" rel="noopener">Google Calendar</a>
      <a class="btn" data-link="webcal">Apple Calendar / Outlook</a>
      <a class="btn" data-link="download">Download .ics</a>
    </div>
    <div class="calendar-url">
      <label class="calendar-url-label" for="calendar-url">Feed URL for any other calendar app</label>
      <div class="calendar-url-row">
        <input id="calendar-url" type="text" readonly>
        <button type="button" class="btn calendar-copy">Copy</button>
      </div>
    </div>
    <p class="calendar-note muted small"></p>`;
  el.hidden = false;

  const $ = (sel) => el.querySelector(sel);
  const input = $('#calendar-url');
  const copy = $('.calendar-copy');
  let prefs = { services: [], market: 'auto' };
  let mode = 'mark';

  function update(nextPrefs = prefs) {
    prefs = nextPrefs;
    const personal = prefs.services.length > 0;
    const selection = feedSelection(prefs.services, team.abbrev);
    const path = personal ? feedPath(team.abbrev, selection, mode) : plainFeedPath(team.abbrev);
    const feed = new URL(path, siteRoot).href;
    const webcal = feed.replace(/^https?:/, 'webcal:');

    $('[data-link="google"]').href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    $('[data-link="webcal"]').href = webcal;
    const download = $('[data-link="download"]');
    download.href = feed;
    download.download = personal ? `${team.abbrev}-${path.split('/').pop()}` : `${team.abbrev}.ics`;
    input.value = feed;

    const names = selection.map((id) => SERVICES.find((s) => s.id === id).name);
    $('.calendar-for').innerHTML = !personal
      ? 'Pick your subscriptions above to personalise the feed. Until then it lists every game with all its channels.'
      : names.length
        ? `Personalised for <strong>${esc(names.join(', '))}</strong>. Games you can’t watch with these:`
        : `None of your subscriptions carry ${esc(team.common)} games. Games you can’t watch:`;
    $('.calendar-modes').hidden = !personal;

    const notes = [];
    if (personal) notes.push('Each subscription combination has its own feed: if yours change, subscribe to the new link.');
    if (personal && prefs.market !== 'auto') {
      notes.push('Feeds always assume you watch from the team’s home market; “Where you watch” only applies on this page.');
    }
    $('.calendar-note').textContent = notes.join(' ');
    $('.calendar-note').hidden = notes.length === 0;
  }

  for (const radio of el.querySelectorAll('input[name="calendar-mode"]')) {
    radio.addEventListener('change', () => {
      mode = radio.value;
      update();
    });
  }
  input.addEventListener('focus', () => input.select());
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      copy.textContent = 'Copied';
    } catch {
      input.focus();
      copy.textContent = 'Press ⌘C / Ctrl+C';
    }
    setTimeout(() => (copy.textContent = 'Copy'), 2000);
  });

  return { update };
}

function renderHero(team, data) {
  const hero = document.getElementById('hero');
  hero.setAttribute('style', teamColorStyle(team.abbrev));
  const season = seasonLabel(data.season);
  hero.innerHTML = `
    <div class="wrap hero-inner">
      <div class="hero-logo"><img src="${esc(team.logo)}" alt="" width="88" height="88"></div>
      <div>
        <p class="hero-eyebrow">${esc(team.division)} Division${season ? ` · ${season}` : ''}</p>
        <h1 class="hero-title">${esc(team.name)}</h1>
      </div>
    </div>`;
}

function marketSentence(cov, data) {
  if (cov.market === null) {
    return 'Assuming you watch from outside every Canadian team’s regional market, so regional broadcasts are blacked out.';
  }
  const label = MARKETS.find((m) => m.id === cov.market)?.label ?? data.teamsByAbbrev.get(cov.market)?.name;
  return `Assuming you watch from the ${esc(label)}. Change “Where you watch” above if that’s not you.`;
}

function renderCoverage(team, data, prefs, cov) {
  const el = document.getElementById('coverage');
  const has = prefs.services.length > 0;

  if (!cov.total) {
    el.innerHTML = `<p class="coverage-lead">No upcoming games for the ${esc(team.common)} right now.</p>`;
    return;
  }

  const lead = has
    ? `You can watch <strong>${cov.watchable}</strong> of <strong>${cov.total}</strong> remaining ${esc(team.common)} games.`
    : `Pick your subscriptions above to see how many of the <strong>${cov.total}</strong> remaining games you can watch.`;

  const tips = has ? suggestions(data.games, team.abbrev, prefs).slice(0, 3) : [];
  const tipsHtml = tips.length
    ? `<div class="suggest">
        <h3>Would add the most</h3>
        <ul>${tips
          .map(
            ({ service, gained }) =>
              `<li><span>${esc(service.name)}</span><span class="suggest-gain">+${gained} game${gained === 1 ? '' : 's'}</span></li>`,
          )
          .join('')}</ul>
      </div>`
    : '';

  el.innerHTML = `
    ${pieWithLabel(
      has ? cov.fraction : null,
      `<strong>${has ? percent(cov.fraction) : '–'}</strong><span>${has ? 'watchable' : 'pick below'}</span>`,
      {
        size: 148,
        thickness: 16,
        className: 'coverage-pie',
        attrs: `role="img" aria-label="${has ? `${percent(cov.fraction)} of remaining games watchable` : 'No subscriptions selected'}"`,
      },
    )}
    <div class="coverage-body">
      <p class="coverage-lead">${lead}</p>
      <p class="coverage-market">${marketSentence(cov, data)}</p>
      ${tipsHtml}
    </div>`;
}

function renderGames(el, team, data, state, cov, rerender) {
  const has = state.prefs.services.length > 0;
  const rows = state.expanded ? cov.rows : cov.rows.slice(0, INITIAL_GAMES);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!cov.rows.length) {
    el.innerHTML = `<h2 id="games-title" class="section-title">Upcoming games</h2><p class="muted">Nothing scheduled.</p>`;
    return;
  }

  const items = [];
  let lastMonth = '';
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  for (const row of rows) {
    const start = new Date(row.game.start);
    const month = monthFmt.format(start);
    if (month !== lastMonth) {
      items.push(`<li class="month">${esc(month)}</li>`);
      lastMonth = month;
    }
    items.push(gameRow(row, team, data, { has, start, today, tomorrow, now }));
  }

  const remaining = cov.rows.length - INITIAL_GAMES;
  const button =
    remaining > 0
      ? `<button type="button" class="expand" aria-expanded="${state.expanded}">
          ${state.expanded ? 'Show fewer games' : `Show all ${cov.rows.length} games`}
        </button>`
      : '';

  el.innerHTML = `
    <div class="games-head">
      <h2 id="games-title" class="section-title">Upcoming games</h2>
      <p class="muted small">Times in your time zone (${esc(tz)})</p>
    </div>
    <ol class="game-list">${items.join('')}</ol>
    ${button}`;

  el.querySelector('.expand')?.addEventListener('click', () => {
    state.expanded = !state.expanded;
    rerender();
    if (!state.expanded) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function gameRow({ game, coverage }, team, data, { has, start, today, tomorrow, now }) {
  const isHome = game.home === team.abbrev;
  const oppAbbrev = isHome ? game.away : game.home;
  const opp = data.teamsByAbbrev.get(oppAbbrev) ?? { abbrev: oppAbbrev, name: oppAbbrev, logo: '', logoDark: '' };

  const key = dayKey(start);
  const dateLabel = key === today ? 'Today' : key === tomorrow ? 'Tomorrow' : dateFmt.format(start);
  const timeLabel = game.schedule === 'TBD' ? 'Time TBD' : timeFmt.format(start);
  let badge = '';
  if (game.schedule === 'PPD') badge = '<span class="badge badge-warn">Postponed</span>';
  else if (start <= now) badge = '<span class="badge badge-live">Live</span>';

  const tv = coverage.broadcasts.map((b) => {
    const regionTeam = b.region ? data.teamsByAbbrev.get(b.region) : null;
    const regionName = regionTeam?.common ?? b.region;
    let cls = 'tv';
    let tag = '';
    let title = 'National broadcast';
    if (b.region) {
      tag = b.blackedOut ? 'blacked out' : 'regional';
      title = b.blackedOut
        ? `${regionName} regional broadcast — blacked out where you watch`
        : `${regionName} regional broadcast`;
    }
    if (b.blackedOut) cls += ' tv-blackout';
    else if (b.mine) cls += ' tv-mine';
    return `<li class="${cls}" title="${esc(title)}"><span class="tv-name">${esc(b.name)}</span>${tag ? `<span class="tv-tag">${tag}</span>` : ''}</li>`;
  });
  if (coverage.outOfMarket) {
    tv.push(
      `<li class="tv tv-mine" title="Out-of-market game on ${esc(coverage.outOfMarketService.name)}"><span class="tv-name">Sportsnet+ Premium</span><span class="tv-tag">out-of-market</span></li>`,
    );
  }
  if (!tv.length) tv.push('<li class="tv tv-none">No Canadian TV listing</li>');

  const status = !has
    ? ''
    : coverage.watchable
      ? `<span class="status status-yes" title="You can watch this game" role="img" aria-label="You can watch this game">${CHECK}</span>`
      : `<span class="status status-no" title="Not on your subscriptions" role="img" aria-label="Not on your subscriptions">${CROSS}</span>`;

  return `
    <li class="game${has && !coverage.watchable ? ' game-off' : ''}">
      <div class="game-when">
        <span class="game-date">${esc(dateLabel)}</span>
        <span class="game-time">${esc(timeLabel)} ${badge}</span>
      </div>
      <div class="game-match">
        <span class="game-ha">${isHome ? 'vs' : '@'}</span>
        ${opp.logo ? logoHtml(opp, { size: 32, className: 'game-logo' }) : ''}
        <span class="game-opp">
          <span class="game-opp-name">${esc(opp.name)}</span>
          ${game.venue ? `<span class="game-venue">${esc(game.venue)}</span>` : ''}
        </span>
      </div>
      <ul class="game-tv" aria-label="Canadian broadcasts">${tv.join('')}</ul>
      <div class="game-status">${status}</div>
    </li>`;
}

const CHECK =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

main();
