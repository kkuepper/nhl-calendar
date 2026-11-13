import { MARKETS, seasonCoverage, suggestions, teamCoverage } from './coverage.js';
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

const INITIAL_GAMES = 10;
const MAX_PAST_SEASONS = 4;

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

async function main() {
  const gamesEl = document.getElementById('games');
  const abbrev = (new URLSearchParams(location.search).get('team') || '').toUpperCase();

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
  document.title = `${team.name} · NHL on Canadian TV`;
  renderHero(team, data);

  const state = { prefs: loadPrefs(), expanded: false, history: [] };
  const render = () => {
    const cov = teamCoverage(data.games, team.abbrev, state.prefs);
    renderCoverage(team, data, state.prefs, cov);
    renderHistory(team, state.history, state.prefs);
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
