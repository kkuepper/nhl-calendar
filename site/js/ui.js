// Shared UI helpers: data loading, saved preferences, the subscription picker,
// the coverage pie and small formatting utilities.

import { DEFAULT_SERVICES, MARKETS, SERVICES } from './coverage.js';

// ---------------------------------------------------------------- data

export async function loadData() {
  const res = await fetch('data/schedule.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load the schedule (HTTP ${res.status}).`);
  const data = await res.json();
  data.teamsByAbbrev = new Map(data.teams.map((t) => [t.abbrev, t]));
  return data;
}

/**
 * Past regular seasons, newest first: [{ season: "20252026", games: [{home, away, tv}] }].
 * Returns [] when the file is missing so the page still works without it.
 */
export async function loadHistory() {
  try {
    // Default HTTP caching: finished seasons change about once a year.
    const res = await fetch('data/history.json');
    if (!res.ok) return [];
    const raw = await res.json();
    return Object.entries(raw.seasons ?? {})
      .map(([season, games]) => ({
        season,
        games: games.map(([home, away, tv]) => ({
          home,
          away,
          tv: tv.map((entry) => {
            const i = entry.lastIndexOf(':');
            return { network: entry.slice(0, i), market: entry.slice(i + 1) };
          }),
        })),
      }))
      .sort((a, b) => b.season.localeCompare(a.season));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- preferences

const PREFS_KEY = 'nhl-calendar:prefs:v1';

export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (raw && Array.isArray(raw.services)) {
      const known = new Set(SERVICES.map((s) => s.id));
      const markets = new Set(MARKETS.map((m) => m.id));
      // Default-on services that didn't exist when these prefs were saved start
      // enabled; ones the viewer has already seen (and maybe switched off) don't.
      const seen = new Set(Array.isArray(raw.seen) ? raw.seen : []);
      const services = raw.services.filter((id) => known.has(id));
      const added = DEFAULT_SERVICES.filter((id) => !seen.has(id) && !services.includes(id));
      return {
        services: [...added, ...services],
        market: markets.has(raw.market) ? raw.market : 'auto',
      };
    }
  } catch {
    // Storage blocked or corrupt: fall through to defaults.
  }
  return { services: [...DEFAULT_SERVICES], market: 'auto' };
}

function savePrefs(prefs) {
  try {
    // `seen` records which options existed, so new default-on ones can be told apart.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, seen: SERVICES.map((s) => s.id) }));
  } catch {
    // Private mode etc. — the picker still works for this page view.
  }
}

// ---------------------------------------------------------------- picker

/**
 * Renders the "Your subscriptions" panel into `container` and calls
 * `onChange(prefs)` whenever the selection or home market changes.
 */
export function mountPicker(container, initialPrefs, onChange, { marketHint = '' } = {}) {
  let prefs = { ...initialPrefs, services: [...initialPrefs.services] };

  container.innerHTML = `
    <div class="prefs-head">
      <div>
        <h2 class="prefs-title">Your subscriptions</h2>
        <p class="prefs-sub">Pick what you have. Your choice is saved in this browser.</p>
      </div>
      <label class="market">
        <span class="market-label">Where you watch</span>
        <select class="market-select">
          ${MARKETS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="chips" role="group" aria-label="Subscriptions">
      ${SERVICES.map(
        (s) => `
        <button type="button" class="chip" data-id="${s.id}" aria-pressed="false">
          <span class="chip-box" aria-hidden="true">${CHECK_ICON}</span>
          <span class="chip-text">
            <span class="chip-name">${esc(s.name)}</span>
            <span class="chip-detail">${esc(s.detail)}</span>
          </span>
        </button>`,
      ).join('')}
    </div>
    ${marketHint ? `<p class="prefs-hint">${marketHint}</p>` : ''}
  `;

  const select = container.querySelector('.market-select');
  const chips = [...container.querySelectorAll('.chip')];

  const sync = () => {
    select.value = prefs.market;
    for (const chip of chips) chip.setAttribute('aria-pressed', String(prefs.services.includes(chip.dataset.id)));
  };

  const commit = () => {
    sync();
    savePrefs(prefs);
    onChange(prefs);
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const id = chip.dataset.id;
      const service = SERVICES.find((s) => s.id === id);
      if (prefs.services.includes(id)) {
        prefs = { ...prefs, services: prefs.services.filter((x) => x !== id) };
      } else {
        // Tiers of the same product (Sportsnet+ Standard / Premium) are exclusive.
        const others = service.group
          ? prefs.services.filter((x) => SERVICES.find((s) => s.id === x)?.group !== service.group)
          : prefs.services;
        prefs = { ...prefs, services: [...others, id] };
      }
      commit();
    });
  }

  select.addEventListener('change', () => {
    prefs = { ...prefs, market: select.value };
    commit();
  });

  sync();
  return prefs;
}

const CHECK_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------------------------------------------------------------- pie

/** A donut chart for a fraction 0–1; `null` draws an empty ring. */
export function pieSvg(fraction, { size = 44, thickness = 6 } = {}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  const f = fraction == null ? 0 : Math.max(0, Math.min(1, fraction));
  const fill =
    f <= 0
      ? ''
      : f >= 1
        ? `<circle class="pie-fill" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${thickness}"/>`
        : `<circle class="pie-fill" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${thickness}"
             stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>`;
  return `<svg class="pie" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="pie-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${thickness}"/>${fill}</svg>`;
}

/**
 * A donut with `labelHtml` centred inside it. `attrs` go on the wrapper: decorative
 * by default, pass role/aria-label when the pie is the only label for its value.
 */
export function pieWithLabel(fraction, labelHtml, { size, thickness, className = '', attrs = 'aria-hidden="true"' }) {
  return `<span class="pie-wrap ${className}" style="width:${size}px;height:${size}px" ${attrs}>
    ${pieSvg(fraction, { size, thickness })}<span class="pie-label">${labelHtml}</span></span>`;
}

export const percent = (fraction) => `${Math.round(fraction * 100)}%`;

// ---------------------------------------------------------------- teams

export function logoHtml(team, { size = 48, className = 'logo', alt = '' } = {}) {
  return `<picture class="${className}">
    <source srcset="${esc(team.logoDark)}" media="(prefers-color-scheme: dark)">
    <img src="${esc(team.logo)}" alt="${esc(alt)}" width="${size}" height="${size}" loading="lazy" decoding="async">
  </picture>`;
}

// Primary / secondary colours, used for accents only.
const TEAM_COLORS = {
  ANA: ['#F47A38', '#B9975B'],
  BOS: ['#111111', '#FFB81C'],
  BUF: ['#003087', '#FFB81C'],
  CAR: ['#CE1126', '#111111'],
  CBJ: ['#002654', '#CE1126'],
  CGY: ['#C8102E', '#F1BE48'],
  CHI: ['#CF0A2C', '#111111'],
  COL: ['#6F263D', '#236192'],
  DAL: ['#006847', '#8F8F8C'],
  DET: ['#CE1126', '#FFFFFF'],
  EDM: ['#041E42', '#FF4C00'],
  FLA: ['#C8102E', '#B9975B'],
  LAK: ['#111111', '#A2AAAD'],
  MIN: ['#154734', '#A6192E'],
  MTL: ['#AF1E2D', '#192168'],
  NJD: ['#CE1126', '#111111'],
  NSH: ['#041E42', '#FFB81C'],
  NYI: ['#00539B', '#F47D30'],
  NYR: ['#0038A8', '#CE1126'],
  OTT: ['#C8102E', '#C2912C'],
  PHI: ['#F74902', '#111111'],
  PIT: ['#111111', '#FCB514'],
  SEA: ['#001628', '#99D9D9'],
  SJS: ['#006D75', '#EA7200'],
  STL: ['#002F87', '#FCB514'],
  TBL: ['#002868', '#FFFFFF'],
  TOR: ['#00205B', '#FFFFFF'],
  UTA: ['#090909', '#6CACE4'],
  VAN: ['#00205B', '#00843D'],
  VGK: ['#333F42', '#B4975A'],
  WPG: ['#041E42', '#AC162C'],
  WSH: ['#041E42', '#C8102E'],
};

export function teamColorStyle(abbrev) {
  const [primary, secondary] = TEAM_COLORS[abbrev] ?? ['#334155', '#94a3b8'];
  return `--team:${primary};--team-2:${secondary}`;
}

// ---------------------------------------------------------------- misc

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function seasonLabel(season) {
  const s = String(season ?? '');
  return s.length === 8 ? `${s.slice(0, 4)}–${s.slice(6)}` : '';
}

export function updatedLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function showError(container, message) {
  container.innerHTML = `<div class="error" role="alert"><strong>Something went wrong.</strong> ${esc(message)}</div>`;
}
