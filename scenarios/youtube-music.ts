import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Scenario } from '#e2e/scenarios/index.ts'
import { savedPagesDir, withScriptsInert } from '#e2e/support/saved-pages.ts'

// The saved YouTube Music page to scrape (`pnpm saved-pages`), from the main checkout's saved-pages/: YTM_PAGE names one
// (without .json), the search for Daft Punk by default, its artist, songs, albums, videos and playlists all in it.
// YTM_VIEW is the Show as view its links are shown in, YouTube Music's own by default.
const SAVED = savedPagesDir('localnet-scraper-youtube-music')

// A cover the page shows, fetched once and kept, or none where it cannot be.
async function picture(src: string): Promise<Buffer> {
  const file = path.join(os.tmpdir(), 'localnet-ytm-pictures', encodeURIComponent(src).slice(-200))
  if (!fs.existsSync(file)) {
    const answer = await fetch(src).catch(() => undefined)
    if (!answer?.ok) {
      return Buffer.alloc(0)
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(await answer.arrayBuffer()))
  }
  return fs.readFileSync(file)
}

export const youtubeMusic: Scenario = {
  about: 'a saved YouTube Music page (YTM_PAGE, the search for Daft Punk by default) scraped, its links shown as YouTube Music (YTM_VIEW), dark',
  async run({ app, site }) {
    const file = path.join(SAVED, `${process.env.YTM_PAGE ?? 'music-youtube-com-search-q-daft-punk'}.json`)
    if (!fs.existsSync(file)) {
      throw new Error(`No saved page ${file}`)
    }
    const { url, html } = JSON.parse(fs.readFileSync(file, 'utf8'))
    site.serve(url, withScriptsInert(html))
    await app.scrape(url)
    // Its covers, from YouTube's servers (kept in the system's temporary folder), as the stand-in has none.
    const links = (await app.all('links') as { originKey: string, picture?: string }[]).filter(link => link.originKey === url)
    for (const src of new Set(links.map(link => link.picture).filter((src): src is string => Boolean(src)))) {
      site.serve(src, { headers: { 'Content-Type': 'image/jpeg' }, body: await picture(src) })
    }
    await app.page.emulateMedia({ colorScheme: 'dark' })
    const view = process.env.YTM_VIEW ?? 'youtube-music'
    await app.go(`#/library?e=links&v=${view}&q=${encodeURIComponent(`item="${url}"`)}`)
    await app.page.locator(`.lnv-${view} .title`).first().waitFor()
    await app.page.waitForFunction(() => Array.from(document.images).every(image => image.complete), null, { timeout: 10_000 }).catch(() => {})
    await app.page.waitForTimeout(500)
  },
}

export default youtubeMusic
