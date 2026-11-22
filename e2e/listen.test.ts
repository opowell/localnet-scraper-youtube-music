import { expect, test } from '#e2e/fixtures.ts'

const YTM = 'https://music.youtube.com'
const SONG = `${YTM}/watch?v=khnokW3Mw24`
const ALBUM = `${YTM}/browse/MPREb_K8qWMWVqXGi`
const LIST = 'OLAK5uy_kNhM2yaBTOVwrcZJepB1C9P3-n5_Sfy5c'
const DAFT = { browseEndpoint: { browseId: 'UCRr1xG_2WIDs18a6cIiCxeA' } }
const json = (body: object) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const runs = (...parts: (string | [string, object])[]) => ({
  runs: parts.map(part => (typeof part === 'string' ? { text: part } : { text: part[0], navigationEndpoint: part[1] })),
})
// YouTube's player, standing in for the real one.
const player = '<!doctype html><body style="margin:0;background:#111;color:#fff;font:24px sans-serif">YouTube player</body>'

// A page of YouTube Music as it is served: its data escaped in a script, for the page's scripts to draw it from.
function servedPage(path: string, params: object, data: object) {
  const escaped = (text: string) => text.replace(/[^\w ]/g, c => (c.charCodeAt(0) < 256 ? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}` : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`))
  return `<!doctype html><title>YouTube Music</title><body><script>const initialData = [];
    initialData.push({path: '${escaped(path)}', params: JSON.parse('${escaped(JSON.stringify(params))}'), data: '${escaped(JSON.stringify(data))}'});
    </script><script>ytcfg = { set() {} }; ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.20261117.06.00","HL":"en"});</script></body>`
}

test.describe('youtube music', () => {
  test('the home page, at its bare address, is read by this scraper, not YouTube\'s, as its links alone, each by its title and picture, shown as YouTube shows them', async ({ app, site }) => {
    const cover = 'https://lh3.googleusercontent.com/ram=w544-h544'
    const frame = 'https://i.ytimg.com/vi/khnokW3Mw24/sddefault.jpg'
    const swatch = (color: string, width: number, height: number) => ({
      headers: { 'Content-Type': 'image/svg+xml' },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`,
    })
    const picture = (url: string, width: number, height: number) => ({ musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url, width, height }] } } })
    site.serveAll({
      [`${YTM}/`]: servedPage('/browse', { browseId: 'FEmusic_home' }, {
        contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicCarouselShelfRenderer: {
          header: { musicCarouselShelfBasicHeaderRenderer: { title: runs('Listen again') } },
          contents: [
            { musicTwoRowItemRenderer: { title: runs(['Random Access Memories', { browseEndpoint: { browseId: 'MPREb_K8qWMWVqXGi' } }]), subtitle: runs('Album', ' • ', ['Daft Punk', DAFT]), thumbnailRenderer: picture(cover, 544, 544) } },
            { musicTwoRowItemRenderer: { title: runs(['Instant Crush', { watchEndpoint: { videoId: 'khnokW3Mw24' } }]), subtitle: runs('Song', ' • ', ['Daft Punk', DAFT], ' • ', '1.2B plays'), thumbnailRenderer: picture(frame, 640, 360) } },
          ],
        } }] } } } }] } },
      }),
      [cover]: swatch('#c9a227', 544, 544),
      [frame]: swatch('#2a9d8f', 640, 360),
    })
    await app.scrape(YTM)
    const item = await app.get('items', YTM)
    expect(item).toMatchObject({ listing: true, content: [] })
    const logs = await app.all('logs')
    expect(logs.map((entry: any) => entry.message).join('\n')).toContain('(via YouTube Music)')
    const links = (await app.all('links')).filter((link: any) => link.originKey === YTM)
    expect(links.map((link: any) => [link.destinationKey, link.title, link.picture])).toEqual([
      [ALBUM, 'Random Access Memories', cover],
      [SONG, 'Instant Crush', frame],
    ])

    // Having no content, its screen is its links, by their titles, even asked for in Read.
    await app.go(`#/library?v=record&q=${encodeURIComponent(`item="${YTM}"`)}`)
    await expect(app.page).toHaveURL(/[?&]e=l(inks)?&/)
    await expect(app.page.locator('.dc-shell__main')).toContainText('Random Access Memories')
    await expect(app.page.getByText(/Linked from here/i)).toHaveCount(0)

    // As YouTube shows them: a card each, its picture, title, by whom, and how often it was played.
    await app.go(`#/library?e=links&v=youtube&q=${encodeURIComponent(`item="${YTM}"`)}`)
    const view = app.page.locator('.lnv-youtube')
    await expect(view.locator('.title')).toHaveText(['Random Access Memories', 'Instant Crush'])
    await expect(view.locator('.channel')).toHaveText(['Daft Punk', 'Daft Punk'])
    await expect(view.locator('.stats').last().locator('span')).toHaveText(['Song', '1.2B plays'])
    await expect(view.locator('.frame').first()).toHaveAttribute('src', cover)
    await expect.poll(() => view.locator('.frame').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    if (process.env.SHOT) {
      await app.page.screenshot({ path: process.env.SHOT })
    }
  })

  test('a song is read from what the page asks YouTube Music for, and Read plays it in YouTube\'s player, its lyrics under it', async ({ app, site }) => {
    site.serve(SONG, servedPage('/watch', {}, {}))
    site.serve(`${YTM}/youtubei/v1/next?prettyPrint=false`, json({
      contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: { watchNextTabbedResultsRenderer: { tabs: [
        { tabRenderer: { content: { musicQueueRenderer: { content: { playlistPanelRenderer: { contents: [{ playlistPanelVideoRenderer: {
          videoId: 'khnokW3Mw24',
          title: runs('Instant Crush'),
          longBylineText: runs(['Daft Punk', DAFT], ' • ', ['Random Access Memories', { browseEndpoint: { browseId: 'MPREb_K8qWMWVqXGi' } }], ' • ', '2013'),
          lengthText: runs('5:38'),
        } }] } } } } } },
        { tabRenderer: { endpoint: { browseEndpoint: { browseId: 'MPLYt_lyrics', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS' } } } } } },
      ] } } } },
    }))
    site.serve(`${YTM}/youtubei/v1/browse?prettyPrint=false`, json({ contents: { sectionListRenderer: { contents: [{ musicDescriptionShelfRenderer: {
      description: runs('I didn\'t want to be the one to forget\nI thought of everything I\'d never regret'),
      footer: runs('Source: Musixmatch'),
    } }] } } }))
    const embed = 'https://www.youtube-nocookie.com/embed/khnokW3Mw24?enablejsapi=1'
    site.serve(embed, player)

    await app.scrape(SONG)
    const item = await app.get('items', SONG)
    expect(item.title).toBe('Instant Crush')
    expect(item.details).toMatchObject({ album: { text: 'Random Access Memories', url: ALBUM }, year: 2013, length: '5:38' })
    expect(site.requests).toContain(`${YTM}/youtubei/v1/next?prettyPrint=false`)

    await app.go(`#/?q=${encodeURIComponent(`item="${SONG}"`)}&v=record`)
    await expect(app.page.locator('.reader iframe.reader-youtube')).toHaveAttribute('src', embed)
    await expect(app.page.locator('.reader')).toContainText('From Random Access Memories (2013)')
    await expect(app.page.locator('.reader')).toContainText('I thought of everything I\'d never regret')
    await expect.poll(() => site.requests.includes(embed)).toBe(true)
  })

  test('an album is read from the data its page is served with, and Read plays the whole of it, one song after another', async ({ app, site }) => {
    const row = (id: string, title: string) => ({ musicResponsiveListItemRenderer: {
      flexColumns: [runs([title, { watchEndpoint: { videoId: id } }]), runs(['Daft Punk', DAFT])].map(text => ({ musicResponsiveListItemFlexColumnRenderer: { text } })),
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: runs('4:36') } }],
    } })
    site.serve(ALBUM, servedPage('/browse', {
      browseId: 'MPREb_K8qWMWVqXGi',
      browseEndpointContextSupportedConfigs: JSON.stringify({ browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' } }),
    }, {
      contents: { twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: {
          title: runs('Random Access Memories'),
          subtitle: runs('Album', ' • ', '2013'),
          straplineTextOne: runs(['Daft Punk', DAFT]),
          secondSubtitle: runs('2 songs', ' • ', '10 minutes'),
        } }] } } } }],
        secondaryContents: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [row('IluRBvnYMoY', 'Give Life Back to Music'), row('ajGKWk0auOc', 'The Game of Love')] } }] } },
      } },
      microformat: { microformatDataRenderer: { urlCanonical: `${YTM}/playlist?list=${LIST}` } },
    }))
    const embed = `https://www.youtube-nocookie.com/embed/IluRBvnYMoY?list=${LIST}&enablejsapi=1`
    site.serve(embed, player)

    await app.scrape(ALBUM)
    const item = await app.get('items', ALBUM)
    expect(item.title).toBe('Random Access Memories')
    expect(item.redirectedTo).toBeUndefined()
    expect(item.details).toMatchObject({ kind: 'Album', year: 2013, songs: 2 })

    await app.go(`#/?q=${encodeURIComponent(`item="${ALBUM}"`)}&v=record`)
    await expect(app.page.locator('.reader iframe.reader-youtube')).toHaveAttribute('src', embed)
    // Its songs, a numbered list.
    const songs = app.page.locator('.reader .reader-item')
    await expect(songs).toHaveText(['Give Life Back to Music · Daft Punk · 4:36', 'The Game of Love · Daft Punk · 4:36'])
    await expect(songs.last()).toHaveAttribute('data-marker', '2.')
    // Its year as it is written.
    await expect(app.page.locator('.reader-aside .reader-details')).toContainText(/Year\s*2013/)
    await expect.poll(() => site.requests.includes(embed)).toBe(true)
  })
})
