import { afterEach, describe, expect, it, vi } from 'vitest'
import { parserLoader, resetPage, visit } from '#scraper-test'

// The parser, evaluated with the helpers it is injected with, as a scrape runs it.
const load = parserLoader(__dirname)

afterEach(() => {
  resetPage()
  vi.unstubAllGlobals()
})

const YTM = 'https://music.youtube.com'

// A string as YouTube Music writes it between single quotes, every character but letters and digits escaped.
function escaped(text: string) {
  return text.replace(/[^\w ]/g, c => (c.charCodeAt(0) < 256 ? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}` : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`))
}

// The script YouTube Music serves a page's data in, after the sidebar's.
function pageData(path: string, params: object, data: object) {
  return `<script>try { const initialData = [];
    initialData.push({path: '\\/guide', params: JSON.parse('\\x7b\\x7d'), data: '${escaped(JSON.stringify({ items: [] }))}'});
    initialData.push({path: '${escaped(path)}', params: JSON.parse('${escaped(JSON.stringify(params))}'), data: '${escaped(JSON.stringify(data))}'});
    ytcfg.set({'YTMUSIC_INITIAL_DATA': initialData});} catch (e) {}</script>
    <script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.20261117.06.00","HL":"en","GL":"US"});</script>`
}

function browseParams(browseId: string, pageType: string) {
  return { browseId, browseEndpointContextSupportedConfigs: JSON.stringify({ browseEndpointContextMusicConfig: { pageType } }) }
}

const runs = (...parts: (string | [string, object])[]) => ({
  runs: parts.map(part => (typeof part === 'string' ? { text: part } : { text: part[0], navigationEndpoint: part[1] })),
})
const browse = (browseId: string) => ({ browseEndpoint: { browseId } })
const watch = (videoId: string) => ({ watchEndpoint: { videoId } })
const thumbnail = (url: string, width = 544) => ({ musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: `${url}-small`, width: 60, height: 60 }, { url, width, height: width }] } } })

// A row of a list of songs: its title, then the columns after it.
function songRow(id: string, title: string, columns: object[], length = '4:36') {
  return {
    musicResponsiveListItemRenderer: {
      flexColumns: [runs([title, watch(id)]), ...columns].map(text => ({ musicResponsiveListItemFlexColumnRenderer: { text } })),
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: runs(length) } }],
      playlistItemData: { videoId: id },
    },
  }
}

// A shelf of cards (an album's other versions, an artist's albums).
function carousel(title: string, cards: [string, object][]) {
  return {
    musicCarouselShelfRenderer: {
      header: { musicCarouselShelfBasicHeaderRenderer: { title: runs(title) } },
      contents: cards.map(([name, endpoint]) => ({ musicTwoRowItemRenderer: { title: runs([name, endpoint]), navigationEndpoint: endpoint } })),
    },
  }
}

const DAFT = 'UCRr1xG_2WIDs18a6cIiCxeA'
const ALBUM = 'MPREb_K8qWMWVqXGi'
const LIST = 'OLAK5uy_kNhM2yaBTOVwrcZJepB1C9P3-n5_Sfy5c'

function albumData() {
  return {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: {
          thumbnail: thumbnail('https://yt3.googleusercontent.com/ram=w544-h544'),
          title: runs('Random Access Memories'),
          subtitle: runs('Album', ' • ', '2013'),
          straplineTextOne: runs(['Daft Punk', browse(DAFT)]),
          description: { musicDescriptionShelfRenderer: { description: runs('The fourth album.\n\nFrom Wikipedia.') } },
          secondSubtitle: runs('13 songs', ' • ', '1 hour, 14 minutes'),
        } }] } } } }],
        secondaryContents: { sectionListRenderer: { contents: [
          { musicShelfRenderer: { contents: [
            songRow('IluRBvnYMoY', 'Give Life Back to Music', [runs(['Daft Punk', browse(DAFT)]), runs('55M plays')]),
            songRow('a5uQMwRMHcs', 'Instant Crush (feat. Julian Casablancas)', [runs(['Daft Punk', browse(DAFT)], ' & ', ['Julian Casablancas', browse('UCWhpbdGLnR8XtXLr0yl2nYA')]), runs('1.2B plays')], '5:38'),
          ] } },
          carousel('Other versions', [['Random Access Memories (10th Anniversary Edition)', browse('MPREb_eMBjPmWySjR')]]),
        ] } },
      },
    },
    microformat: { microformatDataRenderer: { urlCanonical: `${YTM}/playlist?list=${LIST}` } },
  }
}

describe('youtube music', () => {
  it('reads an album as the whole of it, to be played, its description and its songs, headed by its artist', async () => {
    const { parseYouTubeMusic } = load('youtube-music.js', ['parseYouTubeMusic'])
    visit(`${YTM}/browse/${ALBUM}`, pageData('/browse', browseParams(ALBUM, 'MUSIC_PAGE_TYPE_ALBUM'), albumData()))
    const parsed = await parseYouTubeMusic()
    expect(parsed.title).toBe('Random Access Memories')
    expect(parsed.content).toEqual([
      `<post author="Daft Punk" author-url="${YTM}/channel/${DAFT}">`,
      `[![](https://yt3.googleusercontent.com/ram=w544-h544)](https://www.youtube.com/watch?v=IluRBvnYMoY&list=${LIST})`,
      'The fourth album.',
      'From Wikipedia.',
      '1. Give Life Back to Music · Daft Punk · 4:36 · 55M plays',
      '2. Instant Crush (feat. Julian Casablancas) · Daft Punk & Julian Casablancas · 5:38 · 1.2B plays',
    ])
    expect(parsed.canonicalUrl).toBe(`${YTM}/browse/${ALBUM}`)
    expect(parsed.links).toEqual([
      { url: `${YTM}/watch?v=IluRBvnYMoY`, title: 'Give Life Back to Music', score: 0.5 },
      { url: `${YTM}/watch?v=a5uQMwRMHcs`, title: 'Instant Crush (feat. Julian Casablancas)', score: 0.5 },
      { url: `${YTM}/browse/MPREb_eMBjPmWySjR`, score: 0.3 },
      { url: `${YTM}/channel/${DAFT}`, score: 1 },
    ])
    expect(Object.fromEntries(parsed.details)).toMatchObject({
      kind: 'Album',
      artists: [{ text: 'Daft Punk', url: `${YTM}/channel/${DAFT}` }],
      year: 2013,
      songs: 13,
      length: '1 hour, 14 minutes',
    })
  })

  it('reads an album shown at its playlist\'s address as the album', async () => {
    const { parseYouTubeMusic } = load('youtube-music.js', ['parseYouTubeMusic'])
    visit(`${YTM}/playlist?list=${LIST}`, pageData('/browse', browseParams(ALBUM, 'MUSIC_PAGE_TYPE_ALBUM'), albumData()))
    const parsed = await parseYouTubeMusic()
    expect(parsed.canonicalUrl).toBe(`${YTM}/browse/${ALBUM}`)
    expect(parsed.title).toBe('Random Access Memories')
  })

  it('reads a playlist with its owner, views and songs, played as its own list', async () => {
    const { parseYouTubeMusic } = load('youtube-music.js', ['parseYouTubeMusic'])
    const list = 'PLt5IiqEadInpLjM3jcq_B0kjC4Mm0bL6N'
    visit(`${YTM}/playlist?list=${list}`, pageData('/browse', browseParams(`VL${list}`, 'MUSIC_PAGE_TYPE_PLAYLIST'), {
      contents: { twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: {
          thumbnail: thumbnail('https://yt3.ggpht.com/cover=s1200', 1200),
          title: runs('Gorillaz, daft punk, capital cities etc'),
          subtitle: runs('Playlist', ' • ', '2020'),
          secondSubtitle: runs('6.5K views', ' • ', '36 tracks', ' • ', '2 hours, 39 minutes'),
          facepile: { avatarStackViewModel: { text: { content: 'Edson Mc' }, rendererContext: { commandContext: { onTap: { innertubeCommand: browse('UCy-Eud6kmbT08_kvksNhIDQ') } } } } },
        } }] } } } }],
        secondaryContents: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { playlistId: list, contents: [
          songRow('HyHNuVaZJ-k', 'Feel Good Inc.', [runs(['Gorillaz', browse('UCNIV5B_aJnLrKDSnW_MOmcQ')]), runs(['Demon Days', browse('MPREb_demon')])], '4:15'),
        ] } }] } },
      } },
      microformat: { microformatDataRenderer: { urlCanonical: `${YTM}/playlist?list=${list}` } },
    }))
    const parsed = await parseYouTubeMusic()
    expect(parsed.content).toEqual([
      `<post author="Edson Mc" author-url="${YTM}/channel/UCy-Eud6kmbT08_kvksNhIDQ">`,
      `[![](https://yt3.ggpht.com/cover=s1200)](https://www.youtube.com/watch?v=HyHNuVaZJ-k&list=${list})`,
      '1. Feel Good Inc. · Gorillaz · Demon Days · 4:15',
    ])
    expect(parsed.canonicalUrl).toBe(`${YTM}/playlist?list=${list}`)
    expect(Object.fromEntries(parsed.details)).toMatchObject({
      owner: { text: 'Edson Mc', url: `${YTM}/channel/UCy-Eud6kmbT08_kvksNhIDQ` },
      year: 2020,
      songs: 36,
      length: '2 hours, 39 minutes',
      views: 6500,
    })
  })

  it('reads an artist as their top songs, to be played, and what the page says of them', async () => {
    const { parseYouTubeMusic } = load('youtube-music.js', ['parseYouTubeMusic'])
    visit(`${YTM}/channel/${DAFT}`, pageData('/browse', browseParams(DAFT, 'MUSIC_PAGE_TYPE_ARTIST'), {
      header: { musicImmersiveHeaderRenderer: {
        title: runs('Daft Punk'),
        thumbnail: thumbnail('https://lh3.googleusercontent.com/daft=w1080-h450', 1080),
        subscriptionButton: { subscribeButtonRenderer: { longSubscriberCountText: runs('7.22M subscribers') } },
      } },
      contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
        { musicShelfRenderer: {
          title: runs(['Top songs', browse('VLOLAK5uy_top')]),
          bottomEndpoint: browse('VLOLAK5uy_top'),
          contents: [songRow('khnokW3Mw24', 'Instant Crush', [runs(['Daft Punk', browse(DAFT)]), runs('1.2B plays'), runs(['Random Access Memories', browse(ALBUM)])])],
        } },
        carousel('Albums', [['Random Access Memories', browse(ALBUM)], ['Discovery', browse('MPREb_7ltM34kr0mH')]]),
        carousel('Fans might also like', [['Justice', browse('UCjustice')]]),
        { musicDescriptionShelfRenderer: { header: runs('About'), subheader: runs('6,066,806,347 views'), description: runs('A French duo.') } },
      ] } } } }] } },
    }))
    const parsed = await parseYouTubeMusic()
    expect(parsed.title).toBe('Daft Punk')
    expect(parsed.content).toEqual([
      '[![](https://lh3.googleusercontent.com/daft=w1080-h450)](https://www.youtube.com/watch?v=khnokW3Mw24&list=OLAK5uy_top)',
      '## Top songs',
      '1. Instant Crush · Daft Punk · Random Access Memories · 4:36 · 1.2B plays',
      '## About',
      'A French duo.',
    ])
    expect(parsed.links).toEqual([
      { url: `${YTM}/watch?v=khnokW3Mw24`, title: 'Instant Crush', score: 0.5 },
      { url: `${YTM}/browse/${ALBUM}`, score: 0.3 },
      { url: `${YTM}/browse/MPREb_7ltM34kr0mH`, score: 0.3 / 1.1 },
      { url: `${YTM}/channel/UCjustice`, score: 0.3 / 1.2 },
    ])
    expect(Object.fromEntries(parsed.details)).toEqual({ subscribers: 7220000, views: 6066806347 })
  })

  it('reads a search as a listing of what it found, the top result first', async () => {
    const { parseYouTubeMusic } = load('youtube-music.js', ['parseYouTubeMusic'])
    const item = (title: string, endpoint: object) => ({ musicResponsiveListItemRenderer: {
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: runs(title) } }],
      navigationEndpoint: endpoint,
    } })
    visit(`${YTM}/search?q=daft+punk`, pageData('/search', { query: 'daft punk' }, {
      contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
        { musicCardShelfRenderer: { title: runs(['Daft Punk', browse(DAFT)]), contents: [songRow('khnokW3Mw24', 'Instant Crush', [])] } },
        { itemSectionRenderer: { contents: [item('Random Access Memories', browse(ALBUM))] } },
        { itemSectionRenderer: { contents: [item('Presenting Daft Punk', browse('VLRDCLAK5uy_n20'))] } },
        // Pages that are not of their own (a song's credits) are passed over.
        { itemSectionRenderer: { contents: [item('Credits', browse('MPTCkhnokW3Mw24'))] } },
      ] } } } }] } },
    }))
    const parsed = await parseYouTubeMusic()
    expect(parsed.listing).toBe(true)
    expect(parsed.links.map((link: { url: string }) => link.url)).toEqual([
      `${YTM}/channel/${DAFT}`,
      `${YTM}/watch?v=khnokW3Mw24`,
      `${YTM}/browse/${ALBUM}`,
      `${YTM}/playlist?list=RDCLAK5uy_n20`,
    ])
  })

  describe('a song', () => {
    const next = {
      contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: { watchNextTabbedResultsRenderer: { tabs: [
        { tabRenderer: { title: 'Up next', content: { musicQueueRenderer: { content: { playlistPanelRenderer: { contents: [{ playlistPanelVideoRenderer: {
          videoId: 'khnokW3Mw24',
          title: runs('Instant Crush (feat. Julian Casablancas)'),
          longBylineText: runs(['Daft Punk', browse(DAFT)], ' & ', ['Julian Casablancas', browse('UCWhpbdGLnR8XtXLr0yl2nYA')], ' • ', ['Random Access Memories', browse(ALBUM)], ' • ', '2013'),
          lengthText: runs('5:38'),
          thumbnail: { thumbnails: [{ url: 'https://yt3.googleusercontent.com/ram=w60', width: 60, height: 60 }, { url: 'https://yt3.googleusercontent.com/ram=w544', width: 544, height: 544 }] },
        } }] } } } } } },
        { tabRenderer: { title: 'Lyrics', endpoint: { browseEndpoint: { browseId: 'MPLYt_lyrics', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS' } } } } } },
        { tabRenderer: { title: 'Related', endpoint: { browseEndpoint: { browseId: 'MPTRt_related', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_TRACK_RELATED' } } } } } },
      ] } } } },
    }
    const answers: Record<string, object> = {
      'next': next,
      'MPLYt_lyrics': { contents: { sectionListRenderer: { contents: [{ musicDescriptionShelfRenderer: {
        description: runs('I didn\'t want to be the one to forget\nI thought of everything\n\nAnd we will never be alone again'),
        footer: runs('Source: Musixmatch'),
      } }] } } },
      'MPTRt_related': { contents: { sectionListRenderer: { contents: [
        { musicCarouselShelfRenderer: { contents: [songRow('ykYMLQqD2kY', 'Rest My Chemistry', [runs(['Interpol', browse('UCinterpol')])])] } },
        carousel('More from Daft Punk', [['Random Access Memories', browse(ALBUM)], ['Discovery', browse('MPREb_7ltM34kr0mH')]]),
      ] } } },
    }

    it('reads as the song, to be played, its album and its lyrics, headed by its artists, asking for them as the page does', async () => {
      const fetch = vi.fn(async (url: string, init: { body: string }) => {
        const body = JSON.parse(init.body)
        return { ok: true, json: async () => answers[url.includes('/next') ? 'next' : body.browseId] }
      })
      vi.stubGlobal('fetch', fetch)
      const { parseYouTubeMusic } = load('youtube-music.js', ['parseYouTubeMusic'])
      visit(`${YTM}/watch?v=khnokW3Mw24`, '<script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.20261117.06.00","HL":"en","GL":"US"});</script>')
      const parsed = await parseYouTubeMusic()

      const [url, init] = fetch.mock.calls[0]
      expect(url).toBe(`${YTM}/youtubei/v1/next?prettyPrint=false`)
      expect(JSON.parse(init.body)).toMatchObject({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20261117.06.00', hl: 'en' } }, videoId: 'khnokW3Mw24' })
      expect(parsed.title).toBe('Instant Crush (feat. Julian Casablancas)')
      expect(parsed.content).toEqual([
        `<post author="Daft Punk" author-url="${YTM}/channel/${DAFT}" author-2="Julian Casablancas" author-url-2="${YTM}/channel/UCWhpbdGLnR8XtXLr0yl2nYA">`,
        '[![](https://yt3.googleusercontent.com/ram=w544)](https://www.youtube.com/watch?v=khnokW3Mw24)',
        'From Random Access Memories (2013)',
        '## Lyrics',
        'I didn\'t want to be the one to forget\nI thought of everything',
        'And we will never be alone again',
        'Source: Musixmatch',
      ])
      expect(parsed.canonicalUrl).toBe(`${YTM}/watch?v=khnokW3Mw24`)
      expect(parsed.links).toEqual([
        { url: `${YTM}/browse/${ALBUM}`, title: 'Random Access Memories', score: 1 },
        // The songs and albums YouTube Music offers beside it, but for the song's own album, linked already.
        { url: `${YTM}/watch?v=ykYMLQqD2kY`, score: 0.3 },
        { url: `${YTM}/browse/MPREb_7ltM34kr0mH`, score: 0.3 / 1.1 },
        { url: `${YTM}/channel/${DAFT}`, score: 1 },
        { url: `${YTM}/channel/UCWhpbdGLnR8XtXLr0yl2nYA`, score: 1 },
      ])
      expect(Object.fromEntries(parsed.details)).toEqual({
        artists: [{ text: 'Daft Punk', url: `${YTM}/channel/${DAFT}` }, { text: 'Julian Casablancas', url: `${YTM}/channel/UCWhpbdGLnR8XtXLr0yl2nYA` }],
        album: { text: 'Random Access Memories', url: `${YTM}/browse/${ALBUM}` },
        year: 2013,
        length: '5:38',
      })
    })

    it('still reads without lyrics or related songs, and is left to the page\'s text when the song cannot be had', async () => {
      vi.stubGlobal('fetch', async (url: string) => ({ ok: url.includes('/next'), json: async () => next }))
      const { parseYouTubeMusic } = load('youtube-music.js', ['parseYouTubeMusic'])
      visit(`${YTM}/watch?v=khnokW3Mw24`, '')
      const parsed = await parseYouTubeMusic()
      expect(parsed.content.slice(1)).toEqual(['[![](https://yt3.googleusercontent.com/ram=w544)](https://www.youtube.com/watch?v=khnokW3Mw24)', 'From Random Access Memories (2013)'])

      vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
      expect(await parseYouTubeMusic()).toBeNull()
    })
  })

  it('leaves other sites alone', async () => {
    const { parseYouTubeMusic } = load('youtube-music.js', ['parseYouTubeMusic'])
    visit('https://www.youtube.com/watch?v=khnokW3Mw24', '')
    expect(await parseYouTubeMusic()).toBeNull()
  })
})
