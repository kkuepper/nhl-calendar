// Which Canadian subscriptions carry which broadcast codes, and the rules for
// deciding whether a viewer can actually watch a given game.
//
// The NHL API only gives network codes (e.g. "TSN4") plus a market flag:
//   N = national, H = home team's regional feed, A = away team's regional feed.
// Regional feeds are blacked out outside that team's broadcast region.
//
// The mapping below is maintained by hand for the 2026–27 season, plus the
// codes that appear in the past seasons shown on team pages (2022–23 onward).
// If a new code shows up, it is displayed as-is and not counted for any subscription.

// SNF / SNOL are rare alternate Sportsnet feeds seen in 2022–2026 data.
const SPORTSNET_CHANNELS = ['SN', 'SN1', 'SN360', 'SNO', 'SNE', 'SNW', 'SNP', 'SNF', 'SNOL'];

export const SERVICES = [
  {
    // The only over-the-air channels in the data (always national). They carried
    // Saturday games until 2025–26; no NHL games air on CBC since 2026–27.
    id: 'free',
    name: 'Free TV (CBC/CITY)',
    detail: 'Antenna or any TV package · no NHL games since 2025–26',
    networks: ['CBC', 'CITY'],
    defaultOn: true,
  },
  {
    id: 'sportsnet',
    name: 'Sportsnet',
    detail: 'TV package (cable, satellite, IPTV)',
    // FX-CA: Rogers' FX channel, used once as Sportsnet overflow (2024–25).
    networks: [...SPORTSNET_CHANNELS, 'FX-CA'],
  },
  {
    id: 'snplus',
    group: 'sportsnet-plus',
    name: 'Sportsnet+ Standard',
    detail: 'All Sportsnet channels + Sportsnet+ exclusives like Monday Night Hockey',
    networks: [...SPORTSNET_CHANNELS, 'SN+'],
  },
  {
    id: 'snplus-premium',
    group: 'sportsnet-plus',
    name: 'Sportsnet+ Premium',
    detail: 'Standard + out-of-market games',
    networks: [...SPORTSNET_CHANNELS, 'SN+'],
    outOfMarket: true,
  },
  {
    id: 'tsn',
    name: 'TSN',
    detail: 'TV package or TSN+ · regional Canadiens, Senators, Jets, Maple Leafs',
    networks: ['TSN', 'TSN1', 'TSN2', 'TSN3', 'TSN4', 'TSN5'],
    // Only carries NHL games as these teams' regional broadcaster.
    regionalTeams: ['MTL', 'OTT', 'TOR', 'WPG'],
  },
  {
    id: 'rds',
    name: 'RDS',
    detail: 'French · TV package or RDS Direct',
    networks: ['RDS', 'RDS2', 'RDSI'],
    regionalTeams: ['MTL', 'OTT'],
  },
  {
    id: 'tva',
    name: 'TVA Sports',
    detail: 'French national games · TV package or TVA+',
    networks: ['TVAS', 'TVAS2', 'TVAS-D'],
  },
  {
    id: 'prime',
    name: 'Prime Video',
    detail: 'Exclusive Wednesday national games',
    networks: ['Prime'],
  },
];

// National exclusives: these games are not part of the out-of-market package.
const EXCLUSIVE_NETWORKS = new Set(['Prime']);

const NETWORK_NAMES = {
  SN: 'Sportsnet',
  SN1: 'Sportsnet One',
  SN360: 'Sportsnet 360',
  SNO: 'Sportsnet Ontario',
  SNE: 'Sportsnet East',
  SNW: 'Sportsnet West',
  SNP: 'Sportsnet Pacific',
  SNF: 'Sportsnet',
  SNOL: 'Sportsnet',
  'SN+': 'Sportsnet+',
  'FX-CA': 'FX',
  CBC: 'CBC',
  CITY: 'Citytv',
  TSN: 'TSN',
  TSN1: 'TSN1',
  TSN2: 'TSN2',
  TSN3: 'TSN3',
  TSN4: 'TSN4',
  TSN5: 'TSN5',
  RDS: 'RDS',
  RDS2: 'RDS2',
  RDSI: 'RDS Info',
  TVAS: 'TVA Sports',
  TVAS2: 'TVA Sports 2',
  'TVAS-D': 'TVA Sports (stream)',
  Prime: 'Prime Video',
};

export const networkName = (code) => NETWORK_NAMES[code] ?? code;

/** Services selected for first-time visitors. */
export const DEFAULT_SERVICES = SERVICES.filter((s) => s.defaultOn).map((s) => s.id);

// The NHL's regional broadcast territories in Canada: areas of the country and
// the teams whose regional games air there. Territories are shared, so a viewer
// can get more than one team's regional feed: the Flames and Oilers cover the
// same area, as do the Canadiens and Senators, and Saskatchewan and
// Northwestern Ontario each get a third team's games too.
//   teams: whose regional games air in the region
//   home:  whose own fans are assumed to watch from here ("each team's home market")
//   label: short form for the picker, teams first so a phone-width select keeps them
// Sources, checked against each other in Nov 2026:
//   https://www.shawdirect.ca/english/support/article/8360/ (table by region)
//   https://support.bell.ca/fibe_tv/channels/mts_fibe_tv_nhl_blackouts (Nunavut;
//   Manitoba has been Jets-only since they returned in 2011–12)
export const REGIONS = [
  {
    id: 'bc',
    name: 'British Columbia & Yukon',
    label: 'Canucks · BC & Yukon',
    teams: ['VAN'],
    home: ['VAN'],
  },
  {
    id: 'ab',
    name: 'Alberta',
    label: 'Flames, Oilers · Alberta',
    teams: ['CGY', 'EDM'],
    home: ['CGY', 'EDM'],
  },
  {
    id: 'sk',
    name: 'Saskatchewan, Northwest Territories & Nunavut',
    label: 'Flames, Oilers, Jets · Sask. & the North',
    teams: ['CGY', 'EDM', 'WPG'],
    home: [],
  },
  {
    id: 'mb',
    name: 'Manitoba',
    label: 'Jets · Manitoba',
    teams: ['WPG'],
    home: ['WPG'],
  },
  {
    id: 'nwo',
    name: 'Thunder Bay & Northwestern Ontario',
    label: 'Jets, Maple Leafs · NW Ontario',
    teams: ['WPG', 'TOR'],
    home: [],
  },
  {
    id: 'on',
    name: 'Toronto, Southwestern & Northern Ontario',
    label: 'Maple Leafs · Toronto & most of Ontario',
    teams: ['TOR'],
    home: ['TOR'],
  },
  {
    id: 'east',
    name: 'Eastern Ontario, Québec & Atlantic Canada',
    label: 'Canadiens, Senators · Ottawa, Québec & Atlantic',
    teams: ['MTL', 'OTT'],
    home: ['MTL', 'OTT'],
  },
];

// Team → its home region. Mistakes in REGIONS throw here, when the module loads,
// so they fail the calendar build (and the deploy) instead of skewing numbers.
const HOME_REGION = new Map();
for (const region of REGIONS) {
  for (const team of region.home) {
    if (!region.teams.includes(team)) {
      throw new Error(`REGIONS: ${team} is at home in '${region.id}' but its regional games don't air there`);
    }
    if (HOME_REGION.has(team)) {
      throw new Error(`REGIONS: ${team} has two home regions, '${HOME_REGION.get(team).id}' and '${region.id}'`);
    }
    HOME_REGION.set(team, region);
  }
}

/** Regions where `team`'s regional broadcasts air (empty for US teams). */
export const regionsAiring = (team) => REGIONS.filter((r) => r.teams.includes(team));

export const MARKETS = [{ id: 'auto', label: "Each team's home market" }, ...REGIONS.map(({ id, label }) => ({ id, label }))];

/**
 * The region the viewer watches from (an entry of REGIONS), or null when they
 * are outside every team's territory (e.g. "auto" on a US team's page).
 * An unknown region id falls back to the team's home market, like "auto".
 */
export function viewerMarket(marketPref, teamAbbrev) {
  const chosen = marketPref && marketPref !== 'auto' ? REGIONS.find((r) => r.id === marketPref) : undefined;
  return chosen ?? HOME_REGION.get(teamAbbrev) ?? null;
}

function broadcastRegion(broadcast, game) {
  if (broadcast.market === 'H') return game.home;
  if (broadcast.market === 'A') return game.away;
  return null; // national
}

/**
 * How a viewer in `market` (a REGIONS entry or null) with the subscriptions
 * `serviceIds` can watch `game`. Returns each Canadian broadcast annotated with
 * whether it is blacked out for the viewer and whether one of their
 * subscriptions carries it.
 */
export function gameCoverage(game, market, serviceIds) {
  // Before regions were shared, `market` was a team code; fail loudly rather than
  // silently blacking out every regional broadcast.
  if (market !== null && !REGIONS.includes(market)) {
    throw new TypeError(`gameCoverage: market must be an entry of REGIONS or null, got ${JSON.stringify(market)}`);
  }
  const selected = SERVICES.filter((s) => serviceIds.includes(s.id));
  const local = market?.teams ?? [];
  const broadcasts = game.tv.map((b) => {
    const region = broadcastRegion(b, game);
    const blackedOut = region !== null && !local.includes(region);
    const via = selected.filter((s) => s.networks.includes(b.network));
    return {
      ...b,
      name: networkName(b.network),
      region,
      blackedOut,
      mine: !blackedOut && via.length > 0,
    };
  });

  const viaBroadcast = broadcasts.some((b) => b.mine);
  const premium = selected.find((s) => s.outOfMarket);
  // Out-of-market packages black out every team whose regional games air where you watch.
  const inMarket = local.includes(game.home) || local.includes(game.away);
  const exclusive = game.tv.some((b) => EXCLUSIVE_NETWORKS.has(b.network));
  const outOfMarket = !viaBroadcast && Boolean(premium) && !inMarket && !exclusive;

  return { broadcasts, outOfMarket, outOfMarketService: outOfMarket ? premium : null, watchable: viaBroadcast || outOfMarket };
}

const GAME_LENGTH_MS = 4 * 60 * 60 * 1000;

export function isUpcoming(game, now = Date.now()) {
  if (game.state === 'OFF' || game.state === 'FINAL') return false;
  return Date.parse(game.start) + GAME_LENGTH_MS > now;
}

/** Coverage of a team's games in `games` for the given preferences. */
function coverageOf(games, abbrev, prefs) {
  const market = viewerMarket(prefs.market, abbrev);
  const rows = games
    .filter((g) => g.home === abbrev || g.away === abbrev)
    .map((game) => ({ game, coverage: gameCoverage(game, market, prefs.services) }));
  const watchable = rows.filter((r) => r.coverage.watchable).length;
  return {
    market,
    rows,
    total: rows.length,
    watchable,
    fraction: rows.length ? watchable / rows.length : 0,
  };
}

/** Coverage of a team's upcoming games. */
export function teamCoverage(games, abbrev, prefs, now = Date.now()) {
  return coverageOf(games.filter((g) => isUpcoming(g, now)), abbrev, prefs);
}

/** Coverage of all of a team's games in a finished season (from history.json). */
export const seasonCoverage = coverageOf;

/** Services the viewer doesn't have, ranked by how many extra games each would add. */
export function suggestions(games, abbrev, prefs, now = Date.now()) {
  const base = teamCoverage(games, abbrev, prefs, now).watchable;
  return SERVICES.filter((s) => !prefs.services.includes(s.id))
    .map((service) => {
      // Swapping within a tier group (Standard → Premium) replaces, not adds.
      const services = prefs.services
        .filter((id) => !service.group || SERVICES.find((x) => x.id === id)?.group !== service.group)
        .concat(service.id);
      const gained = teamCoverage(games, abbrev, { ...prefs, services }, now).watchable - base;
      return { service, gained };
    })
    .filter((s) => s.gained > 0)
    .sort((a, b) => b.gained - a.gained);
}
