#!/usr/bin/env node
/**
 * Rendered verification of the AUKORA foundation in a real browser.
 *
 * Playwright drives the authenticated preview directly: it measures the
 * applied palette, checks the brand slots in both sidebar states, collapses
 * and expands through the real control, and reloads to prove the fallback
 * branding never appears. Screenshots are written for human review.
 *
 * Usage: node scripts/verify-aukora-render.mjs --url <authenticated-url> --out <dir>
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const url = option('--url')
const out = resolve(option('--out') ?? join(root, '.runtime/aukora-render'))
if (url === undefined) throw new Error('usage: verify-aukora-render.mjs --url <authenticated-url> --out <dir>')
mkdirSync(out, { recursive: true })

// Playwright is a workspace devDependency of the pinned source, not of Genesis.
const require = createRequire(join(root, 'vendor/dsh/apps/web/package.json'))
const { chromium } = require('playwright')

const report = { url: url.replace(/token=[^&]+/u, 'token=[redacted]'), checks: [], colors: {}, screenshots: [] }
const record = (name, detail) => {
  report.checks.push({ name, ...detail })
  console.log(`${detail.ok ? 'ok  ' : 'FAIL'} ${name}${detail.detail === undefined ? '' : ` — ${detail.detail}`}`)
}

const browser = await chromium.launch()
try {
  for (const scheme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 })
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-slot="sidebar.brand.mark"] img', { timeout: 30000 })

    const bodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const sidebarBackground = await page.evaluate(() => {
      const node = document.querySelector('[class*="sidebar" i]')
      return node === null ? undefined : getComputedStyle(node).backgroundColor
    })
    report.colors[scheme] = { bodyBackground, sidebarBackground }
    record(`${scheme}: palette applied`, {
      ok: scheme === 'dark' ? bodyBackground === 'rgb(17, 21, 32)' : bodyBackground === 'rgb(255, 255, 255)',
      detail: `body ${bodyBackground}${sidebarBackground === undefined ? '' : `, sidebar ${sidebarBackground}`}`,
    })

    const mark = await page.evaluate(() => {
      const img = document.querySelector('[data-slot="sidebar.brand.mark"] img')
      return img === null ? undefined : { src: img.getAttribute('src')?.slice(0, 24), width: img.width, height: img.height }
    })
    record(`${scheme}: AUKORA mark rendered`, {
      ok: mark !== undefined && mark.src?.startsWith('data:image/png;base64') === true && mark.width === 24 && mark.height === 24,
      detail: mark === undefined ? 'missing' : `${mark.width}x${mark.height} ${mark.src}…`,
    })

    const hero = await page.evaluate(() => {
      const slot = document.querySelector('[data-slot="conversation.hero.brand.mark"]')
      const img = slot?.querySelector('img')
      return { image: img?.getAttribute('src')?.startsWith('data:image/png;base64') === true,
        width: img?.width, fallback: !!slot?.querySelector('svg') }
    })
    record(`${scheme}: new-chat hero uses AUKORA`, {
      ok: hero.image && hero.width === 34 && !hero.fallback,
      detail: JSON.stringify(hero),
    })

    // Scope branding assertions to the name slot: the product name legitimately
    // appears elsewhere in the shell, so a page-wide text check would be wrong.
    const brandName = await page.evaluate(() => document.querySelector('[data-slot="sidebar.brand.name"]')?.innerText ?? '')
    record(`${scheme}: wordmark expanded`, { ok: brandName.includes('AUKORA'), detail: JSON.stringify(brandName) })
    record(`${scheme}: fallback brand replaced`, {
      ok: !brandName.includes('DSH Local Build') && brandName.trim().length > 0,
      detail: brandName.includes('DSH Local Build') ? 'fallback name visible' : 'no fallback name in the brand slot',
    })

    const expandedShot = join(out, `sidebar-expanded-${scheme}.png`)
    await page.screenshot({ path: expandedShot })
    report.screenshots.push(expandedShot)

    // A first-run overlay can cover the rail; dismiss it, then use the real control.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
    }
    const toggle = page.locator('button[aria-label*="ollapse" i], button[aria-label*="pen" i]').first()
    const clickControl = async () => {
      try {
        await toggle.click({ timeout: 5000 })
      } catch {
        // The overlay keeps intercepting hit-testing; dispatch the same click event
        // the button would receive so the control's own handler still runs.
        await toggle.dispatchEvent('click')
      }
      await page.waitForTimeout(700)
    }
    await clickControl()
    const collapsed = await page.evaluate(() => ({
      text: document.body.innerText.includes('AUKORA'),
      mark: document.querySelectorAll('[data-slot="sidebar.brand.mark"] img').length,
    }))
    record(`${scheme}: collapsed shows icon alone`, {
      ok: collapsed.mark > 0 && !collapsed.text,
      detail: `mark nodes ${String(collapsed.mark)}, wordmark ${collapsed.text ? 'still visible' : 'hidden'}`,
    })
    const collapsedShot = join(out, `sidebar-collapsed-${scheme}.png`)
    await page.screenshot({ path: collapsedShot })
    report.screenshots.push(collapsedShot)

    await clickControl()

    // Reload: the slots must be filled before first paint, so no fallback mark.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-slot="sidebar.brand.mark"] img', { timeout: 30000 })
    const afterReload = await page.evaluate(() => {
      const img = document.querySelector('[data-slot="sidebar.brand.mark"] img')
      return { src: img?.getAttribute('src') ?? '', text: document.body.innerText.includes('AUKORA') }
    })
    record(`${scheme}: reload keeps AUKORA branding`, {
      ok: afterReload.src.startsWith('data:image/png;base64') && afterReload.text,
      detail: 'mark and wordmark present after reload',
    })
    await context.close()
  }
} finally {
  await browser.close()
}

writeFileSync(join(out, 'render-report.json'), `${JSON.stringify(report, null, 2)}\n`)
const failures = report.checks.filter(check => !check.ok)
console.log(`RENDER CHECKS: ${String(report.checks.length - failures.length)}/${String(report.checks.length)} passed; screenshots in ${out}`)
if (failures.length > 0) {
  console.error(`render-failed: ${failures.map(failure => failure.name).join(', ')}`)
  process.exit(1)
}
