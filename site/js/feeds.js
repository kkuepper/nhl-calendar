// Personalised calendar feeds are static files, one per team × subscription
// combination × mode. This module decides which combinations exist and what
// their paths are; it is shared by the browser (to link to the right feed) and
// scripts/build-calendars.mjs (to generate every one of them).
//
// To keep the number of files small and the URLs stable for a whole season,
// combinations only include services that can matter for the team:
//   • regional-only services (TSN, RDS) only for the teams they carry,
//   • one Sportsnet tier at most (each tier includes the channels of the one before).
// Feeds assume the viewer watches from the team's home market.

import { SERVICES } from './coverage.js';

const CODES = {
  free: 'free',
  sportsnet: 'sn',
  snplus: 'snp',
  'snplus-premium': 'snpp',
  tsn: 'tsn',
  rds: 'rds',
  tva: 'tva',
  prime: 'prime',
};

// Ordered from smallest to largest; a later tier carries everything an earlier one does.
const SPORTSNET_TIERS = ['sportsnet', 'snplus', 'snplus-premium'];

export const FEED_MODES = ['mark', 'only'];

/** Services a team's feed can be personalised for. */
export function feedServices(abbrev) {
  return SERVICES.filter((s) => !s.regionalTeams || s.regionalTeams.includes(abbrev)).map((s) => s.id);
}

/** The viewer's services reduced to what makes a difference for this team's feed. */
export function feedSelection(serviceIds, abbrev) {
  const allowed = new Set(feedServices(abbrev));
  const ids = serviceIds.filter((id) => allowed.has(id));
  const topTier = SPORTSNET_TIERS.filter((id) => ids.includes(id)).at(-1);
  return SERVICES.map((s) => s.id).filter(
    (id) => ids.includes(id) && (!SPORTSNET_TIERS.includes(id) || id === topTier),
  );
}

/** Path of a personalised feed, relative to the site root. */
export function feedPath(abbrev, selection, mode) {
  const key = selection.length ? selection.map((id) => CODES[id]).join('-') : 'none';
  return `calendars/${abbrev}/${key}${mode === 'only' ? '-only' : ''}.ics`;
}

/** Path of the plain feed: every game, all channels, nothing marked. */
export const plainFeedPath = (abbrev) => `calendars/${abbrev}.ics`;

/** Every selection a team's personalised feeds are published for. */
export function allFeedSelections(abbrev) {
  const services = feedServices(abbrev);
  const tiers = SPORTSNET_TIERS.filter((id) => services.includes(id));
  const others = services.filter((id) => !SPORTSNET_TIERS.includes(id));
  const selections = [];
  for (const tier of [null, ...tiers]) {
    for (let mask = 0; mask < 1 << others.length; mask++) {
      const picked = others.filter((_, i) => mask & (1 << i));
      selections.push(feedSelection(tier ? [tier, ...picked] : picked, abbrev));
    }
  }
  return selections;
}
