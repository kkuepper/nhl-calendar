import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slateLead } from '../site/js/seo.js';

const ppd = (n) => Array.from({ length: n }, () => ({ schedule: 'PPD' }));
const cncl = (n) => Array.from({ length: n }, () => ({ schedule: 'CNCL' }));
const mix = () => [{ schedule: 'PPD' }, { schedule: 'CNCL' }];

const nextSlate = (calledOff) =>
  slateLead({
    today: false,
    countedCount: 0,
    onTv: 0,
    calledOff,
    nextDateText: 'Saturday, November 28',
    nowLabel: 'Friday, November 27',
  });

test('next slate, all N postponed', () => {
  assert.equal(
    nextSlate(ppd(3)),
    'No NHL games today (Friday, November 27). The next slate is Saturday, November 28, but all 3 games are postponed.',
  );
});

test('next slate, the only game is postponed', () => {
  assert.equal(
    nextSlate(ppd(1)),
    'No NHL games today (Friday, November 27). The next slate is Saturday, November 28, but that game is postponed.',
  );
});

test('next slate, all cancelled or mixed', () => {
  assert.equal(
    nextSlate(cncl(2)),
    'No NHL games today (Friday, November 27). The next slate is Saturday, November 28, but all 2 games are cancelled.',
  );
  assert.equal(
    nextSlate(mix()),
    'No NHL games today (Friday, November 27). The next slate is Saturday, November 28, but all 2 games are postponed or cancelled.',
  );
});

test('today, all postponed or cancelled', () => {
  assert.equal(
    slateLead({ today: true, countedCount: 0, onTv: 0, calledOff: ppd(4), nextDateText: '', nowLabel: '' }),
    'All 4 games today are postponed.',
  );
  assert.equal(
    slateLead({ today: true, countedCount: 0, onTv: 0, calledOff: ppd(1), nextDateText: '', nowLabel: '' }),
    'The only game today is postponed.',
  );
  assert.equal(
    slateLead({ today: true, countedCount: 0, onTv: 0, calledOff: mix(), nextDateText: '', nowLabel: '' }),
    'All 2 games today are postponed or cancelled.',
  );
});

test('today or next slate with games still counted', () => {
  assert.match(
    slateLead({ today: true, countedCount: 15, onTv: 11, calledOff: ppd(1), nextDateText: '', nowLabel: '' }),
    /^15 NHL games today, 11 on Canadian TV\./,
  );
  assert.equal(
    slateLead({
      today: false,
      countedCount: 8,
      onTv: 5,
      calledOff: [],
      nextDateText: 'Saturday, November 28',
      nowLabel: 'Friday, November 27',
    }),
    'No NHL games today (Friday, November 27). The next slate is Saturday, November 28, with 8 games.',
  );
});
