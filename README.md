# NHL on Canadian TV

Every NHL team's upcoming games, the Canadian channels carrying them, and how many of those games you can actually watch with the subscriptions you have.

**Live site:** https://kkuepper.github.io/nhl-calendar/

- **Landing page**: all 32 teams by division. Each shows a coverage pie: the share of its remaining games you can watch with your subscriptions.
- **Team page**: the full coverage breakdown, which subscription would add the most games, and the upcoming schedule (the next 10 games, expandable to the whole season). Each game shows its Canadian broadcasters, tagged *regional*, *blacked out* or *out-of-market*.
- **Past seasons**: up to four more pies on the team page. They apply the same subscriptions and region to each of the last four full regular seasons, so you can see how coverage has shifted. Example: when CBC stopped airing NHL games after 2025–26.
- **Calendar feeds**: iCalendar feeds per team with the Canadian channel in each event title, personalised to your subscriptions. Games you can't watch are marked 🚫 or left out. The team page has one-click buttons for Google Calendar and Apple Calendar/Outlook, a download, and the feed URL for other apps.
- Your subscriptions and "where you watch" are saved in the browser (localStorage) and shared between pages.

## How "watchable" is decided

The NHL API lists each broadcast with a network code and a market:
`N` = national, `H`/`A` = the home/away team's regional feed.

A game counts as watchable when:

1. one of its **national** broadcasts is on a network one of your subscriptions carries, or
2. one of its **regional** broadcasts belongs to a team whose regional games air where you watch, and your subscription carries that network (regional feeds are blacked out elsewhere), or
3. you have **Sportsnet+ Premium**, the game is out of your market (no team whose regional games air where you watch is playing), and it isn't a national exclusive (Prime Video Wednesdays).

### Regions

"Where you watch" is one of the NHL's regional broadcast areas. Teams share territories, so some areas get more than one team's regional games: the Flames and Oilers cover the same area (Alberta, plus Saskatchewan and the North), as do the Canadiens and Senators (Eastern Ontario, Québec and Atlantic Canada). A viewer there sees both teams' regional games with the same subscriptions. Saskatchewan and the North also get the Jets, and Northwestern Ontario gets both the Jets and the Maple Leafs.

The full list of regions and their teams is `REGIONS` in [`site/js/coverage.js`](site/js/coverage.js), taken from [Shaw Direct's NHL blackout table](https://www.shawdirect.ca/english/support/article/8360/) and checked against [Bell MTS's blackout page](https://support.bell.ca/fibe_tv/channels/mts_fibe_tv_nhl_blackouts).

"Where you watch" defaults to *each team's home market*: on a Canadian team's page, the region its own fans are in (Alberta for the Flames and Oilers, Manitoba for the Jets, and so on). US teams have no Canadian region, so only national broadcasts and out-of-market games count for them. Pick a specific region to see every team from one place.

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

- Regions follow TV providers' tables, not the NHL's exact boundaries, which can split a province (for example around Belleville in Ontario).
- Past seasons use **today's** packages and regions. For example, Sportsnet+ Premium's out-of-market games are applied to seasons where that feature was sold under another name, and any change to a team's territory isn't reflected in older seasons.
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

## Calendar feeds

[`scripts/build-calendars.mjs`](scripts/build-calendars.mjs) turns `schedule.json` into iCalendar files (RFC 5545). They're generated on every deploy and not committed.

| Feed | Contents |
|---|---|
| `calendars/{TEAM}.ics` | Plain: every game with all its Canadian channels. Used until you pick subscriptions. |
| `calendars/{TEAM}/{key}.ics` | Personalised: every game; games your subscriptions don't cover start with 🚫. |
| `calendars/{TEAM}/{key}-only.ics` | Personalised: only the games you can watch. |

`{key}` is the subscription combination, e.g. `free-snp-tsn` = Free TV + Sportsnet+ Standard + TSN, or `none`.

**Why one file per combination?** GitHub Pages only serves static files, so a feed can't be built on request from URL parameters. [`site/js/feeds.js`](site/js/feeds.js), shared by the build and the page, keeps the number of combinations small:

- TSN and RDS only count when they carry a team whose regional games air in the feed team's home region (TSN: Canadiens, Senators, Maple Leafs, Jets; RDS: Canadiens, Senators).
- Only one Sportsnet tier counts, since each tier includes the channels of the one before.

That gives 32–128 combinations per team, 2,592 files (about 78 MB) in total. These rules don't depend on the schedule, so a subscribed URL keeps working all season.

Every feed assumes you watch from the team's home market. The site's "Where you watch" setting would multiply the file count by eight, so it only applies on the page. A small server (e.g. a Cloudflare Worker reusing `coverage.js`) could build exact feeds on request, if that's ever needed.

**Event contents:**

- **Title:** the matchup and the channel, e.g. `Canadiens @ Maple Leafs · Sportsnet`. Personalised feeds name the channel *you'd* watch it on. Games you can't watch keep all their channels, so you can see what you're missing: `🚫 Islanders @ Maple Leafs · Prime Video`. Games with no Canadian broadcast say `no Canadian TV`.
- **Description:** ✅/🚫 for your subscriptions, then every Canadian channel, marked *national* or with the team and regions of a regional feed, e.g. *Canadiens regional · Eastern Ontario, Québec & Atlantic Canada*.
- **Times and behaviour:** times are UTC, so every app shows them in your own time zone. Events last 3 hours, are marked as free time (they don't block your availability), and keep a stable `UID`, so changes update existing events instead of duplicating them.

Subscribing:

| App | How |
|---|---|
| Google Calendar | The *Google Calendar* button opens `calendar.google.com/calendar/r?cid=webcal://…`. Google re-reads subscribed feeds on its own schedule, typically every few hours to once a day. |
| Apple Calendar, Outlook desktop | The `webcal://` link opens the app's subscribe dialog. |
| Anything else | Copy the feed URL from the team page and add it as a calendar URL. |

The Google, Apple/Outlook, and download buttons each send one Palmeta count, including a middle-click that opens the link in a new tab. A normal click is not counted twice. Copy sends one only after the feed URL is on the clipboard. The script stores a name, not extra fields, so the name is `cal_<team>_<method>_<feed>`: the team abbreviation, `google`, `webcal`, `download`, or `copy`, and `plain`, `personal`, or `personal_only` (the feed that leaves out games you can't watch). The longest copy name, such as `cal_tor_copy_personal_only`, is 26 characters. The link still opens, and copy still works, if analytics has not loaded.

## Run locally

Requires Node 20+ (for the fetch script) and Python 3 (for a static file server).

```bash
npm run fetch       # refresh site/data/schedule.json (and history.json if a season is missing)
npm run calendars   # build site/calendars/ (all feeds) from schedule.json
npm run serve       # http://localhost:8321
```

No dependencies, no build step: the site is plain HTML, CSS and ES modules in [`site/`](site/).

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every push to `main` and twice a day (05:17 and 16:17 ET). It fetches the latest schedule, commits `site/data/` if anything changed, builds the calendar feeds, and deploys `site/` to GitHub Pages.

GitHub pauses scheduled workflows after 60 days without repository activity. During the season, the data commits keep it active. If it gets paused in the off-season, re-enable it under *Actions → Update data and deploy*.

---

Not affiliated with the NHL. Team names and logos are trademarks of the NHL and its teams. Logos are loaded from the NHL's asset CDN.
