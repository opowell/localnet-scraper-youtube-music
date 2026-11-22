// YouTube Music (music.youtube.com) draws every page with its scripts from data, never from markup it serves: a page's
// data is written into it as it is served (initialData.push({ path, params, data }), see ytmPageData), but for a
// song's (/watch?v=…), which the page asks YouTube for once loaded, as the parser does too (see ytmApi). Songs, albums,
// playlists and artists are told apart by their data, not their address: an album is shown at /browse/MPREb_… and at
// /playlist?list=OLAK5uy_…, a playlist at /playlist?list=….

const YTM = 'https://music.youtube.com'

// A string YouTube Music writes between single quotes in a script, its characters escaped ("\x7b\x22browseId…"), as
// the string it stands for.
function ytmUnescape(text) {
  return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, escape) => {
    if (/^[xu]/.test(escape) && escape.length > 1) {
      return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
    }
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }[escape] ?? escape
  })
}

// The texts of the page's own scripts, joined.
function ytmScripts() {
  return Array.from(document.querySelectorAll('script:not([src])'), script => script.textContent).join('\n')
}

// The data YouTube Music writes into the page as it serves it, for its scripts to draw the page from: each
// initialData.push({ path: '\/browse', params: JSON.parse('…'), data: '…' }), as { path, params, data }, the
// sidebar's (/guide) among them. The scraper runs without the page's variables, so the data is read from the scripts'
// text.
function ytmPageData() {
  const quoted = String.raw`'((?:[^'\\]|\\[\s\S])*)'`
  const push = new RegExp(String.raw`initialData\.push\(\{\s*path:\s*${quoted},\s*params:\s*JSON\.parse\(${quoted}\),\s*data:\s*${quoted}`, 'g')
  const found = []
  for (const [, path, params, data] of ytmScripts().matchAll(push)) {
    try {
      found.push({ path: ytmUnescape(path), params: JSON.parse(ytmUnescape(params)), data: JSON.parse(ytmUnescape(data)) })
    } catch {
      // Data that does not parse is passed over.
    }
  }
  return found
}

// A setting YouTube Music's page is configured with (ytcfg.set({ "INNERTUBE_CLIENT_VERSION": "1.2026…", … })), if
// it names it.
function ytmConfig(name) {
  return new RegExp(`"${name}":\\s*"([^"]*)"`).exec(ytmScripts())?.[1] || null
}

// The object the page's settings name (ytcfg.set({ "INNERTUBE_CONTEXT": { "client": { … } }, … })), read up to the
// brace that closes it; null if they name none.
function ytmConfigObject(name) {
  const text = ytmScripts()
  const at = new RegExp(`"${name}":\\s*\\{`).exec(text)
  if (!at) {
    return null
  }
  const start = at.index + at[0].length - 1
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') {
        i++
      } else if (c === '"') {
        inString = false
      }
    } else if (c === '"') {
      inString = true
    } else if (c === '{') {
      depth++
    } else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

// What YouTube Music answers the page's own call to its API (/youtubei/v1/next, /youtubei/v1/browse), made as the
// page would, with the user's session and the page's own context (INNERTUBE_CONTEXT: its client, language, country
// and visitor, which a continuation of the page's needs), else as its web client (WEB_REMIX); null if it cannot be
// had. query is added to the address (a continuation's).
async function ytmApi(endpoint, body, query = '') {
  const context = ytmConfigObject('INNERTUBE_CONTEXT') || {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: ytmConfig('INNERTUBE_CLIENT_VERSION') || '1.20261117.06.00',
      ...(ytmConfig('HL') ? { hl: ytmConfig('HL') } : {}),
      ...(ytmConfig('GL') ? { gl: ytmConfig('GL') } : {}),
    },
  }
  try {
    const response = await pageFetch(`${location.origin}/youtubei/v1/${endpoint}?${query}prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, ...body }),
    })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

// The text of runs ({ runs: [{ text }, …] }), or of a simple text, '' if none.
function ytmText(text) {
  return text?.runs ? text.runs.map(run => run.text).join('') : text?.simpleText || text?.content || ''
}

// The page of YouTube Music an endpoint leads to: a song's (/watch?v=…), an artist's or user's (/channel/UC…), a
// playlist's (/playlist?list=…), an album's (/browse/MPREb_…), a podcast's or an episode's; null for anything else (a
// song's lyrics and credits, a mix it would play, a list of an artist's albums).
function ytmEndpointUrl(endpoint) {
  const video = endpoint?.watchEndpoint?.videoId
  if (video) {
    return `${YTM}/watch?v=${video}`
  }
  const id = endpoint?.browseEndpoint?.browseId
  if (!id) {
    return null
  }
  if (/^UC[\w-]+$/.test(id)) {
    return `${YTM}/channel/${id}`
  }
  if (/^VL./.test(id)) {
    return `${YTM}/playlist?list=${id.slice(2)}`
  }
  return /^MP(?:REb|SP|ED)/.test(id) ? `${YTM}/browse/${id}` : null
}

// The largest of a renderer's thumbnails, or of a { thumbnails } list, if it has any.
function ytmThumbnail(node) {
  const thumbnails = node?.musicThumbnailRenderer?.thumbnail?.thumbnails || node?.thumbnail?.thumbnails || node?.thumbnails || []
  return thumbnails.reduce((a, b) => ((b.width || 0) * (b.height || 0) > (a.width || 0) * (a.height || 0) ? b : a), thumbnails[0])?.url || null
}

// The picture of an entry (a cover, a video's frame, an artist's photo), as large as YouTube Music serves it: its
// thumbnails are small (60 or 120 pixels), and its pictures on googleusercontent.com come in any size their address
// names (=w120-h120), so a small one is asked for at 544.
function ytmPicture(thumbnail) {
  const url = ytmThumbnail(thumbnail)
  if (!url || !/^https:\/\/(?:lh\d|yt\d)\.(?:googleusercontent|ggpht)\.com\//.test(url)) {
    return url
  }
  return url.replace(/=w(\d+)-h(\d+)/, (size, w, h) => (Number(w) < 544 && w === h ? '=w544-h544' : size))
}

// A number the page writes in short ("7.22M subscribers", "1.2B plays") or in full ("6,066,806,347 views"), null if
// it writes none.
function ytmNumber(text) {
  const match = /(\d[\d,.]*)\s*([KMB])?/.exec(text || '')
  if (!match) {
    return null
  }
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[match[2]] || 1
  return Math.round(Number(match[1].replace(/,/g, '')) * scale)
}

// The artists runs name, each with their page where they have one: [{ name, url? }]. A run naming none (" & ", " • ")
// is left out, and so are the runs after the artists (an album's, a year).
function ytmArtists(runs = []) {
  const artists = []
  for (const run of runs) {
    const url = ytmEndpointUrl(run.navigationEndpoint)
    if (url?.includes('/channel/')) {
      artists.push({ name: run.text, url })
    } else if (url || /^\s*•\s*$/.test(run.text)) {
      break
    } else if (!/^\s*(?:,|&|and|x|feat\.?)\s*$/i.test(run.text) && run.text.trim()) {
      artists.push({ name: run.text.trim() })
    }
  }
  return artists
}

// A row of a list of songs (an album's, a playlist's, an artist's top songs): { title, url, artists, album, length,
// plays }, read from its columns: its title, linking to the song, then its artists, an album, and how often it was
// played, in whichever columns the list has them, and its length. null if it is not of a song.
function ytmSong(row) {
  const columns = (row.flexColumns || []).map(column => column.musicResponsiveListItemFlexColumnRenderer?.text)
  const titleRun = columns[0]?.runs?.[0]
  const id = titleRun?.navigationEndpoint?.watchEndpoint?.videoId || row.playlistItemData?.videoId
  if (!id) {
    return null
  }
  let artistText = ''
  let artists = []
  let album = null
  let plays = null
  for (const column of columns.slice(1)) {
    const text = ytmText(column)
    const runs = column?.runs || []
    const albumRun = runs.find(run => /\/browse\/MPREb/.test(ytmEndpointUrl(run.navigationEndpoint) || ''))
    if (albumRun) {
      album = { text: albumRun.text, url: ytmEndpointUrl(albumRun.navigationEndpoint) }
    } else if (/\b(?:plays|views)$/.test(text)) {
      plays = text
    } else if (text && !artistText) {
      artistText = text
      artists = ytmArtists(runs)
    }
  }
  const fixed = (row.fixedColumns || []).map(column => ytmText(column.musicResponsiveListItemFixedColumnRenderer?.text))
  const entry = ytmEntry('musicResponsiveListItemRenderer', row)
  return {
    title: ytmText(columns[0]),
    url: `${YTM}/watch?v=${id}`,
    artistText,
    artists,
    album,
    length: fixed.find(text => /^\d+(?::\d\d)+$/.test(text)) || null,
    plays,
    picture: entry?.picture || null,
    details: entry?.details || [],
  }
}

// A song as a block of a list: "1. Title · Artist & Artist · Album · 3:45", and "· 1.2B plays" where the list gives
// it (an album's, an artist's top songs).
function ytmSongBlock(song, i) {
  return `${i + 1}. ${[song.title, song.artistText, song.album?.text, song.length, song.plays].filter(Boolean).join(' · ')}`
}

// The songs of the first list of them in a tree of data (an album's, a playlist's, an artist's top songs).
function ytmShelfSongs(shelf) {
  return (shelf?.contents || []).map(entry => entry.musicResponsiveListItemRenderer).filter(Boolean).map(ytmSong).filter(Boolean)
}

// A link to an entry's page, with its title, picture and details, which stand for the page until it is scraped.
function ytmLink(entry, score) {
  return {
    url: entry.url,
    title: entry.title,
    ...(entry.picture ? { picture: entry.picture } : {}),
    ...(entry.details?.length ? { details: entry.details } : {}),
    score,
  }
}

// Links to the entries a tree of data shows (see ytmShelves), in page order, each once and none of those taken
// already, weighing less the further down they are: weight / (1 + rank / 10).
function ytmLinks(tree, weight, taken) {
  return ytmShelves(tree, taken).flatMap(shelf => shelf.entries).map((entry, rank) => ytmLink(entry, weight / (1 + rank / 10)))
}

// The paragraphs of a description, each run of lines between blank lines a block of its own.
function ytmParagraphs(text) {
  return (text || '').split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean)
}

// A whole list of songs (an album's or a playlist's, by its id) as a block Read plays it from, in YouTube's player, one
// song after another, its cover shown until it plays: its first song's watch page on www.youtube.com, naming the list
// (/watch?v=…&list=…), which YouTube's player plays through whatever the list (a mix of YouTube Music's too, which it
// does not play as a list alone), else the list's own page (/playlist?list=…). Its cover alone where it has no list.
function ytmPlaylistBlock(list, cover, first) {
  if (!list) {
    return cover ? [`![](${cover})`] : []
  }
  const id = first && new URL(first).searchParams.get('v')
  const src = id ? `https://www.youtube.com/watch?v=${id}&list=${list}` : `https://www.youtube.com/playlist?list=${list}`
  return [videoBlock(src, cover || '')]
}

// A song (/watch?v=…) reads as its title, the song itself, played in YouTube's player (its watch page on
// www.youtube.com, as Read plays YouTube's videos), the album it is from and its lyrics, headed by its artists. The
// page holds none of it, so it is asked for as the page asks for it once loaded (next, then the lyrics' and related
// tabs' browse). Its details are its artists, album, year and length. It links with weight 1 to its artists and album,
// and with 0.3 / (1 + rank / 10) to what YouTube Music offers beside it (songs, albums, playlists, artists).
async function ytmTrack(id, list) {
  const next = await ytmApi('next', { videoId: id, ...(list ? { playlistId: list } : {}), isAudioOnly: true })
  const watch = next?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
  let song = null
  const findSong = (node) => {
    if (song || !node || typeof node !== 'object') {
      return
    }
    if (node.playlistPanelVideoRenderer?.videoId === id) {
      song = node.playlistPanelVideoRenderer
      return
    }
    Object.values(node).forEach(findSong)
  }
  findSong(watch)
  if (!song) {
    return null
  }
  const byline = song.longBylineText?.runs || []
  const artists = ytmArtists(byline)
  const albumRun = byline.find(run => /\/browse\/MPREb/.test(ytmEndpointUrl(run.navigationEndpoint) || ''))
  const album = albumRun ? { text: albumRun.text, url: ytmEndpointUrl(albumRun.navigationEndpoint) } : null
  const year = byline.map(run => run.text.trim()).find(text => /^(?:1[89]|20)\d\d$/.test(text))
  const tab = pageType => watch.tabs?.map(t => t.tabRenderer?.endpoint?.browseEndpoint)
    .find(endpoint => endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === pageType)?.browseId
  const [lyricsPage, relatedPage] = await Promise.all(['MUSIC_PAGE_TYPE_TRACK_LYRICS', 'MUSIC_PAGE_TYPE_TRACK_RELATED']
    .map(pageType => (tab(pageType) ? ytmApi('browse', { browseId: tab(pageType) }) : null)))
  let lyrics = null
  const findLyrics = (node) => {
    if (lyrics || !node || typeof node !== 'object') {
      return
    }
    if (node.musicDescriptionShelfRenderer) {
      lyrics = node.musicDescriptionShelfRenderer
      return
    }
    Object.values(node).forEach(findLyrics)
  }
  findLyrics(lyricsPage?.contents)

  const url = `${YTM}/watch?v=${id}`
  const content = [videoBlock(`https://www.youtube.com/watch?v=${id}`, ytmThumbnail(song) || '')]
  if (album) {
    content.push(`From ${album.text}${year ? ` (${year})` : ''}`)
  }
  const verses = ytmParagraphs(ytmText(lyrics?.description))
  if (verses.length) {
    content.push('## Lyrics', ...verses)
    const source = ytmText(lyrics.footer).trim()
    if (source) {
      content.push(source)
    }
  }
  const taken = new Set([url, ...artists.map(artist => artist.url), album?.url].filter(Boolean))
  const parsed = articleOf({
    title: ytmText(song.title),
    authors: artists,
    content,
    links: [
      ...(album ? [{ url: album.url, title: album.text, score: 1 }] : []),
      ...ytmLinks(relatedPage?.contents, 0.3, taken),
    ],
  })
  return {
    ...parsed,
    canonicalUrl: url,
    details: [
      ['artists', artists.map(artist => ({ text: artist.name, url: artist.url }))],
      ['album', album],
      ['year', year ? Number(year) : null],
      ['length', ytmText(song.lengthText) || null],
    ],
  }
}

// The head of an album's or playlist's page, its first section: { title, subtitle, …, thumbnail }.
function ytmHeader(data) {
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || data.contents?.singleColumnBrowseResultsRenderer?.tabs || []
  const sections = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || []
  return sections.map(section => section.musicResponsiveHeaderRenderer || section.musicDetailHeaderRenderer).find(Boolean)
    || data.header?.musicDetailHeaderRenderer || data.header?.musicResponsiveHeaderRenderer || null
}

// The sections of an album's or playlist's page under its head: its list of songs, then the shelves after it.
function ytmSections(data) {
  const secondary = data.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents
  if (secondary) {
    return secondary
  }
  const tabs = data.contents?.singleColumnBrowseResultsRenderer?.tabs || []
  return tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || []
}

// An album (/browse/MPREb_…, also shown at /playlist?list=OLAK5uy_…) or a playlist (/playlist?list=…) reads as its
// title, the whole of it, played in YouTube's player from its first song to its last (its playlist on
// www.youtube.com), its description and a block per song, headed by its artists or owner. Its details are its kind
// (Album, Single, EP; a playlist none), artists or owner, year, songs, length and, for a playlist, views. It links with
// weight 1 to its artists' or owner's pages, with 0.5 to each song, and with 0.3 / (1 + rank / 10) to the albums and
// playlists the page shows under it (an album's other versions, more by its artist).
function ytmCollection(entry, album) {
  const { data, params } = entry
  const header = ytmHeader(data)
  if (!header) {
    return null
  }
  const title = ytmText(header.title)
  const subtitle = ytmText(header.subtitle).split('•').map(part => part.trim())
  const counts = ytmText(header.secondSubtitle).split('•').map(part => part.trim())
  const owner = header.facepile?.avatarStackViewModel
  const ownerUrl = ytmEndpointUrl(owner?.rendererContext?.commandContext?.onTap?.innertubeCommand)
  const authors = album
    ? ytmArtists(header.straplineTextOne?.runs)
    : (owner?.text?.content ? [{ name: owner.text.content, url: ownerUrl || undefined }] : ytmArtists(header.straplineTextOne?.runs))
  const description = ytmText(header.description?.musicDescriptionShelfRenderer?.description)
  const sections = ytmSections(data)
  const shelf = sections.map(section => section.musicShelfRenderer || section.musicPlaylistShelfRenderer).find(Boolean)
  const cover = ytmThumbnail(header.thumbnail)
  // An album's songs have no pictures of their own in its list: they are its cover.
  const songs = ytmShelfSongs(shelf).map(song => (song.picture || !album || !cover ? song : { ...song, picture: cover }))
  // An album plays as its own playlist, which its address names, or its canonical one does; a playlist as itself.
  const canonical = data.microformat?.microformatDataRenderer?.urlCanonical
  const list = new URL(canonical || location.href, location.href).searchParams.get('list')
    || shelf?.playlistId || (params.browseId?.startsWith('VL') ? params.browseId.slice(2) : null)
  const url = album ? `${YTM}/browse/${params.browseId}` : `${YTM}/playlist?list=${list}`
  const taken = new Set([url, ...authors.map(author => author.url), ...songs.map(song => song.url)].filter(Boolean))
  const year = subtitle.find(part => /^(?:1[89]|20)\d\d$/.test(part))
  const parsed = articleOf({
    title,
    authors,
    content: [...ytmPlaylistBlock(list, cover, songs[0]?.url), ...ytmParagraphs(description), ...songs.map(ytmSongBlock)],
    links: [
      ...songs.map(song => ytmLink(song, 0.5)),
      ...ytmLinks(sections.filter(section => !section.musicShelfRenderer && !section.musicPlaylistShelfRenderer), 0.3, taken),
    ],
  })
  return {
    ...parsed,
    canonicalUrl: url,
    details: [
      ['kind', album ? subtitle[0] || null : null],
      ['artists', album ? authors.map(author => ({ text: author.name, url: author.url })) : null],
      ['owner', !album && authors[0] ? { text: authors[0].name, url: authors[0].url } : null],
      ['year', year ? Number(year) : null],
      ['songs', ytmNumber(counts.find(part => /\b(?:songs?|tracks?)$/.test(part)))],
      ['length', counts.find(part => /\b(?:minutes?|hours?|seconds?)$/.test(part)) || null],
      ['views', album ? null : ytmNumber(counts.find(part => /\bviews?$/.test(part)))],
    ],
  }
}

// An artist (/channel/UC…) reads as their name, their top songs, played one after another in YouTube's player (the
// playlist "Show all" opens), their picture standing for it until it plays, then a block per top song and what the
// page says about them. Their details are their subscribers and views. They link with weight 0.5 to each top song and
// with 0.3 / (1 + rank / 10) to the albums, singles, videos, playlists and artists the page shows.
function ytmArtist(entry) {
  const { data, params } = entry
  const header = data.header?.musicImmersiveHeaderRenderer || data.header?.musicVisualHeaderRenderer
  const sections = data.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || []
  const shelf = sections.map(section => section.musicShelfRenderer).find(Boolean)
  const songs = ytmShelfSongs(shelf)
  const topList = ytmEndpointUrl(shelf?.bottomEndpoint || shelf?.title?.runs?.[0]?.navigationEndpoint)
  const list = topList?.includes('/playlist?') ? new URL(topList).searchParams.get('list') : null
  const about = sections.map(section => section.musicDescriptionShelfRenderer).find(Boolean)
  const description = ytmText(about?.description) || ytmText(header?.description)
  const url = `${YTM}/channel/${params.browseId}`
  const taken = new Set([url, ...songs.map(song => song.url)])
  const picture = ytmThumbnail(header?.thumbnail)
  return {
    title: ytmText(header?.title),
    content: [
      ...ytmPlaylistBlock(list, picture, songs[0]?.url),
      ...(songs.length ? ['## Top songs', ...songs.map(ytmSongBlock)] : []),
      ...(description ? ['## About', ...ytmParagraphs(description)] : []),
    ],
    links: [
      ...songs.map(song => ytmLink(song, 0.5)),
      ...ytmLinks(sections.filter(section => !section.musicShelfRenderer), 0.3, taken),
    ],
    canonicalUrl: url,
    details: [
      ['subscribers', ytmNumber(ytmText(header?.subscriptionButton?.subscribeButtonRenderer?.longSubscriberCountText))],
      ['views', ytmNumber(ytmText(about?.subheader))],
    ],
  }
}

// The kind of page data is for, as YouTube Music names it ("MUSIC_PAGE_TYPE_ALBUM"), if it names one.
function ytmPageType(entry) {
  try {
    return JSON.parse(entry.params.browseEndpointContextSupportedConfigs || '{}').browseEndpointContextMusicConfig?.pageType || null
  } catch {
    return null
  }
}

// What YouTube Music calls a kind of entry, first in what it says of one ("Album • Boss").
const YTM_KINDS = /^(?:Song|Video|Album|Single|EP|Playlist|Auto playlist|Artist|Profile|Podcast|Episode|Audiobook|Station)$/

// What the page says of an entry under or beside its title, its runs' parts between bullets ("Album • Boss",
// "Song • Daft Punk & Julian Casablancas • 5:38 • 1.2B plays"), as details: its kind, who it is by (each artist with
// their page where the page links them, else the names as written: a mix's "Mystikal, The Game, Pearl Jam"), its album,
// year, length, songs, plays, views, audience (an artist's monthly listeners or subscribers) and age ("5d ago"), as
// [name, value] pairs.
function ytmDetails(runs) {
  const parts = [[]]
  for (const run of runs) {
    // A run may hold bullets of its own ("Artist • 65.4M monthly audience").
    run.text.split(/\s*•\s*/).forEach((text, i) => {
      if (i) {
        parts.push([])
      }
      if (text) {
        parts.at(-1).push({ ...run, text })
      }
    })
  }
  const found = {}
  for (const part of parts) {
    const text = part.map(run => run.text).join('').trim()
    const urls = part.map(run => ytmEndpointUrl(run.navigationEndpoint))
    const albumAt = urls.findIndex(url => url?.includes('/browse/MPREb'))
    if (!text) {
      continue
    }
    if (albumAt >= 0) {
      found.album = { text: part[albumAt].text, url: urls[albumAt] }
    } else if (urls.some(url => url?.includes('/channel/'))) {
      found.by = ytmArtists(part).map(artist => (artist.url ? { text: artist.name, url: artist.url } : artist.name))
    } else if (YTM_KINDS.test(text)) {
      found.kind = text
    } else if (/\bplays$/.test(text)) {
      found.plays = ytmNumber(text)
    } else if (/\bviews$/.test(text)) {
      found.views = ytmNumber(text)
    } else if (/\b(?:monthly audience|subscribers)$/.test(text)) {
      found.audience = ytmNumber(text)
    } else if (/^\d+(?::\d\d)+$/.test(text)) {
      found.length = text
    } else if (/^(?:1[89]|20)\d\d$/.test(text)) {
      found.year = Number(text)
    } else if (/\b(?:songs?|tracks?|episodes?)$/.test(text)) {
      found.songs = ytmNumber(text)
    } else if (/\bago$/.test(text)) {
      found.age = text
    } else if (!found.by) {
      found.by = [text]
    }
  }
  return ['kind', 'by', 'album', 'year', 'length', 'songs', 'plays', 'views', 'audience', 'age']
    .filter(name => found[name] != null).map(name => [name, found[name]])
}

// What an entry of a list or a shelf is (a song, an album, an artist, a playlist, a search's top result): { url,
// title, picture, details } (see ytmPicture, ytmDetails), read from what the page says under or beside its title;
// null for one leading to no page of its own (a mood's button), and undefined for anything that is no entry.
function ytmEntry(kind, node) {
  if (!['musicResponsiveListItemRenderer', 'musicTwoRowItemRenderer', 'musicCardShelfRenderer', 'musicMultiRowListItemRenderer'].includes(kind)) {
    return undefined
  }
  const columns = (node.flexColumns || []).map(column => column.musicResponsiveListItemFlexColumnRenderer?.text)
  const titleText = node.title || columns[0]
  const url = ytmEndpointUrl(titleText?.runs?.[0]?.navigationEndpoint) || ytmEndpointUrl(node.navigationEndpoint)
    || ytmEndpointUrl(node.onTap) || (node.playlistItemData?.videoId && `${YTM}/watch?v=${node.playlistItemData.videoId}`)
  const title = ytmText(titleText).trim()
  if (!url || !title) {
    return null
  }
  const fixed = (node.fixedColumns || []).map(column => column.musicResponsiveListItemFixedColumnRenderer?.text)
  const said = node.subtitle ? [node.subtitle] : [...columns.slice(1), ...fixed]
  const runs = said.filter(text => ytmText(text).trim()).flatMap((text, i) => [...(i ? [{ text: ' • ' }] : []), ...(text.runs || [{ text: ytmText(text) }])])
  return { url, title, picture: ytmPicture(node.thumbnailRenderer || node.thumbnail), details: ytmDetails(runs) }
}

// The title of a shelf: its header's ("Listen again", "Song mixes"), or its own; a search's top result, whose own
// title is the result's, is "Top result" where its header names none.
function ytmShelfTitle(kind, shelf) {
  const header = shelf.header && Object.values(shelf.header)[0]
  const title = ytmText(header?.title) || (kind === 'musicCardShelfRenderer' ? 'Top result' : ytmText(shelf.title))
  return title.trim()
}

// The shelves a tree of data shows, in page order: [{ title, entries }], each entry once (see ytmEntry). Entries in no
// shelf (a search's results, each in a section of its own) are gathered where they stand, in a shelf of their own,
// "More results" after a shelf, else untitled. A search's top result is an entry with songs of its own under it.
function ytmShelves(tree, seen = new Set()) {
  const shelves = []
  const add = (shelf, entry) => {
    if (!entry || seen.has(entry.url)) {
      return
    }
    seen.add(entry.url)
    let into = shelf
    if (!into) {
      into = shelves.at(-1)?.loose ? shelves.at(-1) : { title: shelves.length ? 'More results' : '', entries: [], loose: true }
      if (into !== shelves.at(-1)) {
        shelves.push(into)
      }
    }
    into.entries.push(entry)
  }
  const visit = (node, shelf) => {
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, shelf))
      return
    }
    if (!node || typeof node !== 'object') {
      return
    }
    for (const [kind, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') {
        continue
      }
      if (/ShelfRenderer$|^gridRenderer$/.test(kind) && !Array.isArray(value)) {
        const own = { title: ytmShelfTitle(kind, value), entries: [] }
        shelves.push(own)
        if (kind === 'musicCardShelfRenderer') {
          add(own, ytmEntry(kind, value))
        }
        visit(value.contents || value.items, own)
        continue
      }
      const entry = ytmEntry(kind, value)
      if (entry !== undefined) {
        add(shelf, entry)
        continue
      }
      visit(value, shelf)
    }
  }
  visit(tree)
  return shelves.filter(shelf => shelf.entries.length)
}

// The playlists the sidebar lists (the user's own, Liked Music among them, when signed in), as a shelf.
function ytmGuidePlaylists(guide) {
  const entries = []
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== 'object') {
      return
    }
    const entry = node.guideEntryRenderer
    const url = entry && ytmEndpointUrl(entry.navigationEndpoint)
    if (url?.includes('/playlist?')) {
      entries.push({ url, title: ytmText(entry.formattedTitle).trim(), details: [['kind', 'Playlist']] })
      return
    }
    Object.values(node).forEach(visit)
  }
  visit(guide?.items)
  return entries.filter(entry => entry.title).length ? [{ title: 'Your playlists', entries: entries.filter(entry => entry.title) }] : []
}

// The token for the next part of a page that loads more as it is scrolled (the home page's shelves), if it has one.
function ytmContinuation(tree) {
  return [tree?.continuations].flat().find(Boolean)?.nextContinuationData?.continuation || null
}

// How many more parts of a page to ask for, as the page would when scrolled, each holding a few shelves.
const YTM_MORE_PARTS = 3

// A page listing songs, albums, artists and playlists (a search, the home page, explore, a mood's, a user's, a
// podcast's) has no content of its own: it is a listing, linking to each entry it shows by its place, shelf by shelf,
// with the entry's title, picture and what the page says of it (see ytmLink), so that its screen lists them. The home
// page holds its first few shelves, and its later ones are asked for as the page would as it is scrolled (at most
// YTM_MORE_PARTS more parts); the playlists the sidebar lists (the user's own) follow them. A search is named for what
// it searches.
async function ytmListing(entry, guide) {
  const seen = new Set([new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href).href.split('#')[0]])
  const sections = entry.data.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
  const shelves = ytmShelves(entry.data.contents, seen)
  let token = ytmContinuation(sections)
  for (let part = 0; token && part < YTM_MORE_PARTS; part++) {
    const more = (await ytmApi('browse', {}, `ctoken=${encodeURIComponent(token)}&continuation=${encodeURIComponent(token)}&type=next&`))
      ?.continuationContents?.sectionListContinuation
    if (!more) {
      break
    }
    shelves.push(...ytmShelves(more.contents, seen))
    token = ytmContinuation(more)
  }
  if (entry.params?.browseId === 'FEmusic_home') {
    shelves.push(...ytmGuidePlaylists(guide).map(shelf => ({ ...shelf, entries: shelf.entries.filter(item => !seen.has(item.url)) })))
  }
  const entries = shelves.flatMap(shelf => shelf.entries)
  const query = entry.path === '/search' ? entry.params?.query : null
  return {
    listing: true,
    ...(query ? { title: `${query} - YouTube Music` } : {}),
    content: [],
    links: entries.map((item, rank) => ytmLink(item, 1 / (1 + rank / 10))),
  }
}

// What a page of YouTube Music shows (see each kind's own function). A search (/search?q=…), the home page and any
// other page (an explore page, a mood's, a user's, a podcast's) is a listing of the songs, albums, artists and
// playlists it shows, shelf by shelf, the top result first (see ytmListing).
async function parseYouTubeMusic(_profileId) {
  if (location.hostname !== 'music.youtube.com') {
    return null
  }
  // The page can rewrite its address once loaded, so the address it was asked for is the one read.
  const asked = new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href)
  const id = asked.pathname === '/watch' && asked.searchParams.get('v')
  if (id) {
    return ytmTrack(id, asked.searchParams.get('list'))
  }
  const data = ytmPageData()
  const entry = data.find(found => found.path !== '/guide')
  if (!entry) {
    return null
  }
  const pageType = entry.path === '/browse' ? ytmPageType(entry) : null
  if (pageType === 'MUSIC_PAGE_TYPE_ALBUM' || pageType === 'MUSIC_PAGE_TYPE_AUDIOBOOK') {
    return ytmCollection(entry, true)
  }
  if (pageType === 'MUSIC_PAGE_TYPE_PLAYLIST') {
    return ytmCollection(entry, false)
  }
  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
    return ytmArtist(entry)
  }
  return ytmListing(entry, data.find(found => found.path === '/guide')?.data)
}

// The parser a scrape calls.
registerParser(parseYouTubeMusic)
