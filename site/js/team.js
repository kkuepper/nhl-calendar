import { SERVICES, gameCoverage, isUpcoming, seasonCoverage, suggestions, teamCoverage, viewerMarket } from './coverage.js';
import { feedPath, feedSelection, plainFeedPath } from './feeds.js';
import { calendarCardHtml, teamDescription, teamJsonLd, teamTitle, teamUrl } from './seo.js';
import {
  CHECK,
  CROSS,
  esc,
  findGame,
  loadData,
  loadHistory,
  loadPrefs,
  logoHtml,
  markGameRow,
  mountFeedbackLink,
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

/**
 * Title, description, canonical, social tags, and SportsEvent JSON-LD. Uses the
 * same wording as the prerendered page, recomputed for the current time, so a
 * page built this morning still names the right game tonight. The FAQ JSON-LD
 * (#seo-faq) is left as built.
 */
function applyTeamMeta(team, data) {
  const title = teamTitle(team, data);
  const description = teamDescription(team, data);
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
  ld.textContent = JSON.stringify(teamJsonLd(team, data));
}

async function main() {
  mountFeedbackLink();
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

  // `expanded` = show all upcoming games; `historyOpen` = "Compare past seasons" toggle.
  const state = { prefs: loadPrefs(), expanded: false, history: [], historyOpen: false };
  const render = () => {
    const cov = teamCoverage(data.games, team.abbrev, state.prefs);
    renderCoverage(team, data, state.prefs, cov);
    markNextGame(team, data, state.prefs);
    renderHistory(team, state);
    calendar.update(state.prefs);
    renderGames(gamesEl, team, data, state, cov, render);
  };

  state.prefs = mountPicker(document.getElementById('prefs'), state.prefs, (next) => {
    state.prefs = next;
    render();
  });
  render();

  state.history = await historyPromise;
  renderHistory(team, state);
}

/**
 * Past-season donuts, as a collapsed "Compare past seasons" section at the
 * bottom of the coverage card. renderCoverage rewrites #coverage (and its
 * #history slot) on every change, so the open/closed state lives in
 * `state.historyOpen` and is restored here.
 */
function renderHistory(team, state) {
  const el = document.getElementById('history');
  if (!el) return;
  const { prefs } = state;
  const seasons = state.history
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
    <details class="history-details"${state.historyOpen ? ' open' : ''}>
      <summary class="history-toggle">Compare past seasons</summary>
      <div class="history-body">
        <p class="muted small history-note">Same subscriptions and region, applied to each full regular season. Until 2025–26, CBC and Citytv carried Saturday games — those count under Free TV.</p>
        <ol class="history-list">${items.join('')}</ol>
      </div>
    </details>`;
  el.querySelector('details').addEventListener('toggle', (e) => {
    state.historyOpen = e.currentTarget.open;
  });
}

/**
 * The "Add to your calendar" card. Feeds are static files built by
 * scripts/build-calendars.mjs, one per subscription combination (see feeds.js);
 * `update(prefs)` points every link at the feed for the current selection.
 *
 * Team pages ship this card prerendered (calendarCardHtml in seo.js) with links
 * to the plain feed, so crawlers and no-JS visitors see it. That markup is kept;
 * only hrefs and the short status lines change. It is rendered here only when
 * the page has none (the legacy team.html).
 */
function mountCalendar(team) {
  const el = document.getElementById('calendar');
  if (!el.querySelector('[data-link]')) {
    el.innerHTML = calendarCardHtml(team, { howTo: new URL('how-to/', siteRoot).href, root: siteRoot });
  }
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
    // Personalised feeds share the same path pattern; rebuild Outlook/Google links from the chosen file.
    const webcal = feed.replace(/^https?:/, 'webcal:');
    const outlookQuery = `url=${encodeURIComponent(feed)}&name=${encodeURIComponent(`${team.name} on Canadian TV`)}`;

    const google = $('[data-link="google"]');
    if (google) google.href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    const apple = $('[data-link="webcal"]');
    if (apple) apple.href = webcal;
    const live = $('[data-link="live"]');
    if (live) live.href = `https://outlook.live.com/calendar/0/addfromweb?${outlookQuery}`;
    const work = $('[data-link="work"]');
    if (work) work.href = `https://outlook.office.com/calendar/0/addfromweb?${outlookQuery}`;
    const download = $('[data-link="download"]');
    if (download) {
      download.href = feed;
      download.download = personal ? `${team.abbrev}-${path.split('/').pop()}` : `${team.abbrev}.ics`;
    }
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
    // Only when the page's region differs from the home region the feed assumes.
    if (personal && viewerMarket(prefs.market, team.abbrev) !== viewerMarket('auto', team.abbrev)) {
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
  const feedKind = () => (prefs.services.length === 0 ? 'plain' : mode === 'only' ? 'personal_only' : 'personal');
  const countLink = (method) => {
    if (method !== 'google' && method !== 'webcal' && method !== 'live' && method !== 'work' && method !== 'download') return;
    trackCalendarSubscribe(team.abbrev, method, feedKind());
  };
  for (const link of el.querySelectorAll('[data-link]')) {
    const method = link.getAttribute('data-link');
    // Primary click only. A middle-click is auxclick, not a second click.
    link.addEventListener('click', (event) => {
      if (event.button !== 0) return;
      countLink(method);
    });
    link.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      countLink(method);
    });
  }
  input.addEventListener('focus', () => input.select());
  copy.addEventListener('click', async () => {
    const feed = feedKind();
    let copied = false;
    try {
      await navigator.clipboard.writeText(input.value);
      copy.textContent = 'Copied';
      copied = true;
    } catch {
      input.focus();
      copy.textContent = 'Press ⌘C / Ctrl+C';
    }
    if (copied) trackCalendarSubscribe(team.abbrev, 'copy', feed);
    setTimeout(() => (copy.textContent = 'Copy'), 2000);
  });

  return { update };
}

/**
 * One subscribe or copy. Palmeta stores a name and a count, so the team,
 * button, and feed are the name: cal_tor_google_plain, cal_tor_copy_personal_only.
 * Outlook.com is `live`, Microsoft 365 is `work`. The longest names, a 3-letter
 * team plus personal_only, stay at 26 characters (the limit is 32).
 * personal_only is the "leave them out" feed.
 * A missing script, or a throw, does not stop the link or the copy.
 */
function trackCalendarSubscribe(abbrev, method, feed) {
  const name = `cal_${String(abbrev).toLowerCase()}_${method}_${feed}`;
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) return;
  try {
    if (typeof window.palmetaAnalytics !== 'function') {
      window.palmetaAnalytics = function (command, value) {
        ;(window.palmetaAnalytics.q = window.palmetaAnalytics.q || []).push([command, value]);
      };
      window.palmetaAnalytics.q = window.palmetaAnalytics.q || [];
    }
    window.palmetaAnalytics('event', { name, count: 1 });
  } catch {
    // The subscribe link still opens.
  }
}

function renderHero(team, data) {
  const hero = document.getElementById('hero');
  // Prerendered team pages already have their hero.
  if (hero.querySelector('.hero-title')) return;
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

/**
 * Highlights the prerendered next-game card (#next-game) for the viewer's
 * subscriptions and region, like the upcoming list. The card only gets a check
 * when the game is watchable, no cross.
 */
function markNextGame(team, data, prefs) {
  const row = document.querySelector('#next-game .next-row');
  if (!row) return;
  const game = findGame(data.games, row);
  const done = Boolean(game) && (game.schedule === 'PPD' || game.schedule === 'CNCL' || !isUpcoming(game));
  const coverage = !done && game ? gameCoverage(game, viewerMarket(prefs.market, team.abbrev), prefs.services) : null;
  markGameRow(row, coverage, { has: prefs.services.length > 0 && !done, rowStatus: true });
}

function marketSentence(cov, data) {
  if (cov.market === null) {
    return 'Assuming you watch from outside every Canadian team’s regional market, so regional broadcasts are blacked out.';
  }
  const teams = new Intl.ListFormat('en', { type: 'conjunction' }).format(
    cov.market.teams.map((t) => data.teamsByAbbrev.get(t)?.common ?? t),
  );
  return `Assuming you watch from ${esc(cov.market.name)}, where ${esc(teams)} regional games air. Change “Where you watch” above if that’s not you.`;
}

function renderCoverage(team, data, prefs, cov) {
  const el = document.getElementById('coverage');
  const has = prefs.services.length > 0;

  // Slot for the "Compare past seasons" toggle (filled by renderHistory).
  const historySlot = `<div id="history" class="history" hidden></div>`;

  if (!cov.total) {
    el.innerHTML = `
      <p class="coverage-lead coverage-empty">No upcoming games for the ${esc(team.common)} right now.</p>
      ${historySlot}`;
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
    </div>
    ${historySlot}`;
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
    // Prime Video carries English and French in Canada; RDS/TVA are French.
    if (b.network === 'Prime' || /^(RDS|TVAS)/.test(b.network)) {
      tag = tag ? `${tag} · FR` : 'FR';
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

main();
