# YouTube Music scraper for Localnet

Reads `music.youtube.com` pages for Localnet, a browser extension that is a personal search engine.
Localnet pulls it from here the first time it scrapes such a page, through the
[localnet-scrapers](https://github.com/opowell/localnet-scrapers) scraper source.

- `source.json`: what Localnet reads to know the scraper: its name, the URLs it reads, how the site is searched, and the file to run.
- `youtube-music.js`: the parser. It is injected into the scraped page after Localnet's DOM helpers (content-scripts/utils/dom.js) and defines `window.__dynamicParser`.
- `youtube-music.test.ts`: its unit tests, run from a Localnet checkout (`pnpm parsers pull`, then `pnpm test parsers/localnet-scraper-youtube-music`).
- `e2e/`: end-to-end tests, run from a Localnet checkout (`npx playwright test parsers/localnet-scraper-youtube-music/e2e`): a song and an album scraped and played in Read.
- `saved-pages/` (not in git): real pages saved from the site, which Localnet's `e2e/saved-pages.test.ts` scrapes. See Localnet's README.
  A plain request gets YouTube Music's "browser not supported" page, so save a page with a desktop browser's user agent.

The pattern is `://music.youtube.com` (no slash, so the bare `https://music.youtube.com` is matched too). Localnet reads a page with the scraper whose pattern it matches most narrowly,
so these pages go to this scraper rather than to YouTube's (`youtube.com`).

## What it reads

YouTube Music draws every page with its scripts, from data rather than markup: a page is served with its data written
into a script (`initialData.push({ path, params, data })`, its strings escaped as `\x7b\x22…`), which the parser reads
from the script's text, as the scraper runs without the page's variables. A song's page holds none of it: the page asks
YouTube Music's API for it once loaded, and so does the parser, as the page would (with the user's session, as its
`WEB_REMIX` client of the page's `INNERTUBE_CLIENT_VERSION`). Pages are told apart by their data, not their address.

Everything a song, album, playlist or artist reads as can be listened to in Read: its first block is YouTube's player
(Read plays a YouTube watch page in `youtube-nocookie.com`'s embed), playing the song, or the whole list one song after
another (`https://www.youtube.com/watch?v=<first song>&list=<list>`, which YouTube's player plays through for every
kind of list, YouTube Music's own mixes too).

- A **song** (`/watch?v=…`) reads as its title, the song in YouTube's player (its watch page on `www.youtube.com`, the
  same video), the album it is from (`"From Random Access Memories (2013)"`) and its lyrics under a `## Lyrics` heading,
  a block per verse with its line breaks, then their source (`"Source: Musixmatch"`), headed by its artists. It is read
  from what `/youtubei/v1/next` says of it (the entry of the queue for its `videoId`: title, artists, album, year,
  length, cover), then `/youtubei/v1/browse` of its Lyrics tab and Related tab. Its details are its artists, album,
  year and length. It links with weight 1 to its artists and album, and with `0.3 / (1 + rank / 10)` to the songs,
  albums, playlists and artists its Related tab shows. Its address is `/watch?v=<id>` (`canonicalUrl`), whatever list
  or start time it was opened with. If the song cannot be had, the page is left to its text.
- An **album** (`/browse/MPREb_…`, also shown at `/playlist?list=OLAK5uy_…`, which is an alias of it) reads as its
  title, the whole album in YouTube's player (its own list, `OLAK5uy_…`), its description, and a block per song
  (`"5. Instant Crush (feat. Julian Casablancas) · Daft Punk & Julian Casablancas · 5:38 · 1.2B plays"`), headed by its
  artists. Its details are its kind (`Album`, `Single`, `EP`), artists, year, songs and length. It links with weight 1
  to its artists, 0.5 to each song, and `0.3 / (1 + rank / 10)` to the albums the page shows under it (its other
  versions, more by its artist).
- A **playlist** (`/playlist?list=…`) reads as an album does, headed by its owner (YouTube Music for its own), played
  as itself. Its details are its owner, year, songs, length and views; it links with weight 1 to its owner's page and
  0.5 to each song. Only the songs the page is served with are read; those a long playlist loads as it is scrolled are not.
- An **artist** (`/channel/UC…`) reads as their name, their top songs in YouTube's player (the list **Show all**
  opens), their picture shown until it plays, a block per top song (with its album and plays) under `## Top songs`,
  and what the page says about them under `## About`. Their details are their subscribers and views. They link with
  weight 0.5 to each top song and with `0.3 / (1 + rank / 10)` to the albums, singles, videos, playlists and artists
  the page shows.
- A **search** (`/search?q=…`), the home page and any other page (explore, a mood, a user's or a podcast's page) is a
  listing with no content of its own (`content: []`, so YouTube Music's sidebar is not taken for it): Localnet shows it
  as its links. It links to each entry it shows, shelf by shelf in page order (a search's top result first), by its
  place, each link with the entry's title, its picture (a cover or a frame, asked for at 544 pixels where YouTube Music
  serves a small one) and what the page says of it, as details: its kind, who it is by (each artist with their page
  where it is linked), its album, year, length, songs, plays, views, audience and age. The home page is served with its
  first few shelves and loads the rest as it is scrolled, so the parser asks for up to 3 more parts as the page would
  (`/youtubei/v1/browse?ctoken=…&type=next`, with the page's own `INNERTUBE_CONTEXT`, its visitor among it, without
  which YouTube Music answers with the home page again); the playlists the sidebar lists (the user's own when signed
  in) follow. A search is titled `<term> - YouTube Music`. Links from songs, albums, playlists and artists to what they
  show carry the same, an album's songs its cover.
