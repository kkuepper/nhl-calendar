# NHL on Canadian TV

Every NHL team's upcoming games, the Canadian channels carrying them, and how many of those games you can actually watch with the subscriptions you have.

**Live site:** https://kkuepper.github.io/nhl-calendar/

- **Landing page**: all 32 teams by division. Each shows a coverage pie: the share of its remaining games you can watch with your subscriptions.
- **Team page**: the full coverage breakdown, which subscription would add the most games, and the upcoming schedule (the next 10 games, expandable to the whole season). Each game shows its Canadian broadcasters, tagged *regional*, *blacked out* or *out-of-market*.
- **Past seasons**: up to four more pies on the team page. They apply the same subscriptions and region to each of the last four full regular seasons, so you can see how coverage has shifted. Example: when CBC stopped airing NHL games after 2025–26.
- Your subscriptions and "where you watch" are saved in the browser (localStorage) and shared between pages.

## How "watchable" is decided

The NHL API lists each broadcast with a network code and a market:
`N` = national, `H`/`A` = the home/away team's regional feed.

A game counts as watchable when:

1. one of its **national** broadcasts is on a network one of your subscriptions carries, or
2. one of its **regional** broadcasts belongs to the team whose region you watch from, and your subscription carries that network (regional feeds are blacked out elsewhere), or
3. you have **Sportsnet+ Premium**, the game is out of your market (your team isn't playing), and it isn't a national exclusive (Prime Video Wednesdays).

"Where you watch" defaults to *each team's home market*. On a Canadian team's page that means that team's region. US teams have no Canadian region, so only national broadcasts and out-of-market games count for them. Pick a specific region (e.g. *Toronto Maple Leafs region*) to see every team from one place.

### Subscription → network mapping

Maintained by hand in [`site/js/coverage.js`](site/js/coverage.js) for the 2026–27 season:

| Subscription | Network codes |
|---|---|
| Free TV (CBC/CITY), on by default | `CBC` `CITY`: over the air; Saturday games until 2025–26, none since |
| Sportsnet (TV package) | `SN` `SN1` `SN360` `SNO` `SNE` `SNW` `SNP` |
| Sportsnet+ Standard | Sportsnet channels + `SN+` (Monday Night Hockey and other streaming exclusives) |
| Sportsnet+ Premium | Standard + out-of-market games |
| TSN (TV package or TSN+) | `TSN1`–`TSN5` |
| RDS | `RDS` `RDS2` `RDSI` |
| TVA Sports | `TVAS` `TVAS2` `TVAS-D` |
| Prime Video | `Prime` |

Older codes from past seasons are folded in too: `SNF`, `SNOL` (Sportsnet), `FX-CA` (Sportsnet overflow) and `… (JIP)` (join-in-progress) variants.

Unknown codes are shown as-is and not counted. The fetch script prints every code it sees, so new ones are easy to spot.

**Known simplifications**

- Regional territories overlap in reality (for example Saskatchewan or Atlantic Canada); the site models one region at a time.
- Past seasons use **today's** packages. For example, Sportsnet+ Premium's out-of-market games are applied to seasons where that feature was sold under another name.
- Package details (e.g. which Sportsnet+ tier has which streaming exclusives) change between seasons, so check the mapping each fall.

## Data

[`scripts/fetch-data.mjs`](scripts/fetch-data.mjs) reads the public, undocumented NHL web API (`api-web.nhle.com`):

- `/v1/standings/now` for the 32 teams, divisions and logos
- `/v1/club-schedule-season/{TEAM}/now` for each team's season, including `tvBroadcasts`

It writes two files:

- [`site/data/schedule.json`](site/data/schedule.json): the current season's regular season and playoffs. Canadian broadcasts only, one game per line so diffs stay readable. It's only rewritten when the schedule actually changes, so `updatedAt` means "last change".
- [`site/data/history.json`](site/data/history.json): the previous four regular seasons in compact form. Finished seasons don't change, so they're fetched once and cached. Only a newly finished season is downloaded, at the next rollover.

The API has Canadian broadcasters for every season back to **2006–07**. Codes before 2014–15 come from the previous rights era (`SNET-O (HD)`, `LEAFS TV`, national `TSN`), so they don't map onto today's subscriptions.

The API sends no CORS headers, so the browser can't call it directly. That's why the data is fetched at build time.

## Run locally

Requires Node 20+ (for the fetch script) and Python 3 (for a static file server).

```bash
npm run fetch   # refresh site/data/schedule.json (and history.json if a season is missing)
npm run serve   # http://localhost:8321
```

No dependencies, no build step: the site is plain HTML, CSS and ES modules in [`site/`](site/).

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every push to `main` and twice a day (05:17 and 16:17 ET). It fetches the latest schedule, commits `site/data/` if anything changed, and deploys `site/` to GitHub Pages.

GitHub pauses scheduled workflows after 60 days without repository activity. During the season, the data commits keep it active. If it gets paused in the off-season, re-enable it under *Actions → Update data and deploy*.

## Roadmap

- iCal feeds per team (with the channel in each event), generated next to `schedule.json` so calendars can subscribe to them.

---

Not affiliated with the NHL. Team names and logos are trademarks of the NHL and its teams. Logos are loaded from the NHL's asset CDN.
