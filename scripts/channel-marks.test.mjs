import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REGIONS, channelMarks, gameCoverage, slateCoverage } from '../site/js/coverage.js';

const region = (id) => REGIONS.find((r) => r.id === id);

// Senators at Maple Leafs: Leafs regional on TSN4, Senators regional on Sportsnet East, national TVA.
const ottAtTor = {
  away: 'OTT',
  home: 'TOR',
  tv: [
    { network: 'TSN4', market: 'H' },
    { network: 'SNE', market: 'A' },
    { network: 'TVAS', market: 'N' },
  ],
};

const usGame = { away: 'BOS', home: 'NYR', tv: [] };

test('channelMarks: mine, blacked out, and plain pills by display name', () => {
  const marks = channelMarks(gameCoverage(ottAtTor, region('east'), ['sportsnet']));
  assert.equal(marks.get('Sportsnet East'), 'mine');
  assert.equal(marks.get('TSN4'), 'blackout');
  assert.equal(marks.has('TVA Sports'), false);
});

test('channelMarks: one mine broadcast is enough for a shared display name', () => {
  const game = {
    away: 'OTT',
    home: 'TOR',
    tv: [
      { network: 'SNF', market: 'H' },
      { network: 'SN', market: 'N' },
    ],
  };
  const marks = channelMarks(gameCoverage(game, region('east'), ['sportsnet']));
  assert.equal(marks.get('Sportsnet'), 'mine');
});

test('channelMarks: nothing mine without subscriptions', () => {
  const marks = channelMarks(gameCoverage(ottAtTor, region('east'), []));
  assert.equal(marks.get('Sportsnet East'), undefined);
  assert.equal(marks.get('TSN4'), 'blackout');
});

test('slateCoverage: auto market blacks out neither team’s regional feed', () => {
  const cov = slateCoverage(ottAtTor, { market: 'auto', services: ['sportsnet', 'tsn'] });
  const marks = channelMarks(cov);
  assert.equal(marks.get('Sportsnet East'), 'mine');
  assert.equal(marks.get('TSN4'), 'mine');
  assert.equal(cov.watchable, true);
  assert.equal(cov.broadcasts.some((b) => b.blackedOut), false);
});

test('slateCoverage: a chosen region applies its blackouts', () => {
  const marks = channelMarks(slateCoverage(ottAtTor, { market: 'on', services: ['sportsnet', 'tsn'] }));
  assert.equal(marks.get('TSN4'), 'mine');
  assert.equal(marks.get('Sportsnet East'), 'blackout');
});

test('slateCoverage: out-of-market package for a game without Canadian TV', () => {
  const cov = slateCoverage(usGame, { market: 'auto', services: ['snplus-premium'] });
  assert.equal(cov.outOfMarket, true);
  assert.equal(cov.outOfMarketService.id, 'snplus-premium');
  assert.equal(cov.watchable, true);
});

test('slateCoverage: no out-of-market for a game in the chosen region', () => {
  const cov = slateCoverage({ ...ottAtTor, tv: [] }, { market: 'east', services: ['snplus-premium'] });
  assert.equal(cov.outOfMarket, false);
  assert.equal(cov.watchable, false);
});
