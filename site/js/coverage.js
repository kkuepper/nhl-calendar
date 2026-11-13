// Which Canadian subscriptions carry which broadcast codes, and the rules for
// deciding whether a viewer can actually watch a given game.
//
// The NHL API only gives network codes (e.g. "TSN4") plus a market flag:
//   N = national, H = home team's regional feed, A = away team's regional feed.
// Regional feeds are blacked out outside that team's broadcast region.
//
// The mapping below is maintained by hand for the 2026–27 season. If a new code
// shows up, it is displayed as-is and simply not counted for any subscription.

const SPORTSNET_CHANNELS = ['SN', 'SN1', 'SN360', 'SNO', 'SNE', 'SNW', 'SNP'];

export const SERVICES = [
  {
    id: 'sportsnet',
    name: 'Sportsnet',
    detail: 'TV package (cable, satellite, IPTV)',
    networks: SPORTSNET_CHANNELS,
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
  },
  {
    id: 'rds',
    name: 'RDS',
    detail: 'French · TV package or RDS Direct',
    networks: ['RDS', 'RDS2', 'RDSI'],
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
  'SN+': 'Sportsnet+',
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

export const CANADIAN_TEAMS = ['CGY', 'EDM', 'MTL', 'OTT', 'TOR', 'VAN', 'WPG'];

export const MARKETS = [
  { id: 'auto', label: "Each team's home market" },
  { id: 'CGY', label: 'Calgary Flames region' },
  { id: 'EDM', label: 'Edmonton Oilers region' },
  { id: 'MTL', label: 'Montréal Canadiens region' },
  { id: 'OTT', label: 'Ottawa Senators region' },
  { id: 'TOR', label: 'Toronto Maple Leafs region' },
  { id: 'VAN', label: 'Vancouver Canucks region' },
  { id: 'WPG', label: 'Winnipeg Jets region' },
];

/**
 * The regional market the viewer is in, as a Canadian team abbreviation, or
 * null when they are in none of the regions involved (e.g. "auto" on a US team).
 */
export function viewerMarket(marketPref, teamAbbrev) {
  if (marketPref && marketPref !== 'auto') return marketPref;
  return CANADIAN_TEAMS.includes(teamAbbrev) ? teamAbbrev : null;
}

function broadcastRegion(broadcast, game) {
  if (broadcast.market === 'H') return game.home;
  if (broadcast.market === 'A') return game.away;
  return null; // national
}

/**
 * How a viewer in `market` with the subscriptions `serviceIds` can watch `game`.
 * Returns each Canadian broadcast annotated with whether it is blacked out for
 * the viewer and whether one of their subscriptions carries it.
 */
export function gameCoverage(game, market, serviceIds) {
  const selected = SERVICES.filter((s) => serviceIds.includes(s.id));
  const broadcasts = game.tv.map((b) => {
    const region = broadcastRegion(b, game);
    const blackedOut = region !== null && region !== market;
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
  const inMarket = market !== null && (market === game.home || market === game.away);
  const exclusive = game.tv.some((b) => EXCLUSIVE_NETWORKS.has(b.network));
  const outOfMarket = !viaBroadcast && Boolean(premium) && !inMarket && !exclusive;

  return { broadcasts, outOfMarket, outOfMarketService: outOfMarket ? premium : null, watchable: viaBroadcast || outOfMarket };
}

const GAME_LENGTH_MS = 4 * 60 * 60 * 1000;

export function isUpcoming(game, now = Date.now()) {
  if (game.state === 'OFF' || game.state === 'FINAL') return false;
  return Date.parse(game.start) + GAME_LENGTH_MS > now;
}

export function upcomingGames(games, abbrev, now = Date.now()) {
  return games.filter((g) => (g.home === abbrev || g.away === abbrev) && isUpcoming(g, now));
}

/** Coverage of a team's upcoming games for the given preferences. */
export function teamCoverage(games, abbrev, prefs, now = Date.now()) {
  const market = viewerMarket(prefs.market, abbrev);
  const rows = upcomingGames(games, abbrev, now).map((game) => ({
    game,
    coverage: gameCoverage(game, market, prefs.services),
  }));
  const watchable = rows.filter((r) => r.coverage.watchable).length;
  return {
    market,
    rows,
    total: rows.length,
    watchable,
    fraction: rows.length ? watchable / rows.length : 0,
  };
}

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
