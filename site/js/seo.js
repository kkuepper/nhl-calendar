// Shared copy and structured data for the home page and each team page.
// Used by the browser (team.js) and by scripts/build-seo.mjs.

import { isUpcoming, networkName } from './coverage.js';

export const SITE_URL = 'https://kkuepper.github.io/nhl-calendar/';

export const HOME_TITLE = 'NHL schedule on Canadian TV · Sportsnet, TSN, TVA Sports';

export const HOME_DESCRIPTION =
  'NHL schedule on Canadian TV: every team’s upcoming games and the channels that carry them, including Sportsnet, TSN, RDS, TVA Sports, and Prime Video.';

export function teamUrl(abbrev) {
  return `${SITE_URL}team/${abbrev}/`;
}

export function teamTitle(team) {
  return `${team.name} schedule on Canadian TV`;
}

export function teamDescription(team) {
  return `Upcoming ${team.name} games and which Canadian channels carry them: Sportsnet, TSN, RDS, TVA Sports, and Prime Video.`;
}

export function channelLabel(broadcast) {
  const name = networkName(broadcast.network);
  return broadcast.market === 'N' ? name : `${name} (regional)`;
}

export function upcomingGames(games, abbrev, now = Date.now()) {
  return games
    .filter((game) => (game.home === abbrev || game.away === abbrev) && isUpcoming(game, now))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

function sportsTeam(team) {
  return { '@type': 'SportsTeam', name: team.name, sport: 'Ice Hockey' };
}

export function sportsEvent(game, teamsByAbbrev) {
  const home = teamsByAbbrev.get(game.home);
  const away = teamsByAbbrev.get(game.away);
  const channels = (game.tv ?? []).map(channelLabel);
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
  return event;
}

export function teamJsonLd(team, games, teamsByAbbrev, now) {
  const upcoming = upcomingGames(games, team.abbrev, now);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: teamTitle(team),
    description: teamDescription(team),
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
        item: sportsEvent(game, teamsByAbbrev),
      })),
    },
  };
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
