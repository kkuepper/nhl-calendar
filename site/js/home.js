import { teamCoverage } from './coverage.js';
import {
  esc,
  loadData,
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

const DIVISIONS = [
  { name: 'Atlantic', conference: 'Eastern' },
  { name: 'Metropolitan', conference: 'Eastern' },
  { name: 'Central', conference: 'Western' },
  { name: 'Pacific', conference: 'Western' },
];

const MARKET_HINT =
  "“Each team's home market” assumes you live where that team's regional games air. " +
  'US teams have no Canadian regional market, so only national broadcasts and Sportsnet+ Premium’s out-of-market games count for them.';

async function main() {
  const container = document.getElementById('teams');
  let data;
  try {
    data = await loadData();
  } catch (err) {
    showError(container, err.message);
    return;
  }

  const season = seasonLabel(data.season);
  if (season) document.getElementById('season').textContent = `${season} season`;
  if (data.updatedAt) document.getElementById('updated').textContent = `Last change: ${updatedLabel(data.updatedAt)}.`;

  let prefs = loadPrefs();
  const render = () => renderTeams(container, data, prefs);
  prefs = mountPicker(
    document.getElementById('prefs'),
    prefs,
    (next) => {
      prefs = next;
      render();
    },
    { marketHint: esc(MARKET_HINT) },
  );
  render();
}

function renderTeams(container, data, prefs) {
  const now = Date.now();
  const hasServices = prefs.services.length > 0;

  const known = new Set(DIVISIONS.map((d) => d.name));
  const divisions = [...DIVISIONS];
  // Keep any division the API adds in the future.
  for (const t of data.teams) {
    if (!known.has(t.division)) {
      known.add(t.division);
      divisions.push({ name: t.division, conference: t.conference });
    }
  }

  const coverage = new Map(data.teams.map((t) => [t.abbrev, teamCoverage(data.games, t.abbrev, prefs, now)]));
  const anyWatchable = [...coverage.values()].some((c) => c.watchable > 0);

  const sections = divisions.map((division) => {
    const teams = data.teams
      .filter((t) => t.division === division.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    const cards = teams.map((team) => teamCard(team, coverage.get(team.abbrev), hasServices));
    return `
      <section class="division" aria-labelledby="div-${esc(division.name)}">
        <h2 class="division-title" id="div-${esc(division.name)}">
          ${esc(division.name)} <span>${esc(division.conference)} Conference</span>
        </h2>
        <div class="team-grid">${cards.join('')}</div>
      </section>`;
  });

  const hint = !hasServices
    ? '<p class="empty-hint">Select your subscriptions above to see how many games you can watch.</p>'
    : !anyWatchable
      ? '<p class="empty-hint">None of the remaining games air on what you’ve picked. Add your subscriptions above.</p>'
      : '';

  container.innerHTML = hint + sections.join('');
}

function teamCard(team, cov, hasServices) {
  const value = hasServices && cov.total ? percent(cov.fraction) : '–';
  const detail = hasServices ? `${cov.watchable} of ${cov.total} games` : `${cov.total} games left`;
  const label = hasServices
    ? `${team.name}: you can watch ${cov.watchable} of ${cov.total} remaining games`
    : `${team.name}: ${cov.total} remaining games`;
  return `
    <a class="team-card" href="team/${encodeURIComponent(team.abbrev)}/" style="${teamColorStyle(team.abbrev)}" aria-label="${esc(label)}">
      ${logoHtml(team, { size: 48, className: 'team-card-logo' })}
      <span class="team-card-name">
        <span class="team-card-place">${esc(team.place)}</span>
        <strong>${esc(team.common)}</strong>
        <small class="team-card-detail">${esc(detail)}</small>
      </span>
      ${pieWithLabel(hasServices ? cov.fraction : null, value, { size: 58, thickness: 6, className: 'team-card-pie' })}
    </a>`;
}

main();
