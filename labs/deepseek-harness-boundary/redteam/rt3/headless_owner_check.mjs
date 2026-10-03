// RT3 headless-Chrome check of the gate OWNER page: swatch renders, warnings show, Reject is first in tab order,
// Tab/Enter/Space can never approve (step 1 -> step 2 needs a TYPED hex), then rejects via keyboard (Tab -> Enter).
// usage: node headless_owner_check.mjs <port> <bearer-file: .json {bearer} or link file ?k=>   (bearer never printed)
import puppeteer from '/tmp/rt3/pt/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
import fs from 'node:fs'
const [, , port, bf] = process.argv
const raw = fs.readFileSync(bf, 'utf8'); const k = bf.endsWith('.json') ? JSON.parse(raw).bearer : new URL(raw.trim()).searchParams.get('k')
const url = `http://127.0.0.1:${port}/?k=${encodeURIComponent(k)}`
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const pg = await b.newPage(); const R = { steps: [] }
const st = async (label) => { const s = await pg.evaluate(() => ({ msg: document.querySelector('.msg')?.textContent ?? '', pending: document.querySelectorAll('.card').length, step2: !!document.querySelector('form.confirm') })); R.steps.push({ label, ...s }); if (/^APPLIED/.test(s.msg)) R.APPLIED = true; return s }
const nav = (fn) => Promise.all([pg.waitForNavigation({ waitUntil: 'load', timeout: 5000 }).catch(() => null), fn()])
await pg.goto(url, { waitUntil: 'load' })
R.render = await pg.evaluate(() => { const c = document.querySelector('.card'); if (!c) return { card: false }
  const chips = [...c.querySelectorAll('.chip')].map(e => { const r = e.getBoundingClientRect(); return { bg: getComputedStyle(e).backgroundColor, img: getComputedStyle(e).backgroundImage !== 'none', w: r.width, h: r.height } })
  const w = c.querySelector('.warn'); return { card: true, plain: c.querySelector('.plain')?.textContent, after: c.querySelector('.after')?.textContent, chips,
    warnings_visible: !!w && w.getBoundingClientRect().height > 0, warnings: [...c.querySelectorAll('.warn li')].map(l => l.textContent.slice(0, 90)) } })
await pg.screenshot({ path: `/tmp/rt3/owner_page_${port}.png`, fullPage: true })
// tab order
const order = []; for (let i = 0; i < 8; i++) { await pg.keyboard.press('Tab'); order.push(await pg.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}${e.name ? ':' + e.name + '=' + (e.value || '').slice(0, 14) : ''}` : 'none' })) }
R.tab_order = order.map(x => x.replace(/k=.*/, 'k=<bearer>')); R.approve_in_tab_order = order.some(x => /approve|confirm/.test(x))
// Space/Enter on body
await pg.evaluate(() => document.activeElement?.blur()); await pg.keyboard.press('Enter'); await pg.keyboard.press('Space'); await st('Enter+Space on body')
// keyboard on Approve step 1 (focused programmatically) -> must only open step 2
await pg.focus('button.ap1'); await nav(() => pg.keyboard.press('Enter')); await st('Enter on Approve step1')
if ((await st('after step1')).step2) {
  await pg.focus('form.confirm input[name=typed]'); await nav(() => pg.keyboard.press('Enter')); await st('Enter in empty confirm box')
  await pg.focus('button.ap1'); await nav(() => pg.keyboard.press('Space')); await st('Space on Approve step1')
  const t2 = []; for (let i = 0; i < 8; i++) { await pg.keyboard.press('Tab'); t2.push(await pg.evaluate(() => document.activeElement?.name || document.activeElement?.tagName)) } R.step2_tab_order = t2
  await pg.focus('form.confirm button'); await nav(() => pg.keyboard.press('Space')); await st('Space on Confirm button (focused programmatically)')
  await pg.focus('button.ap1'); await nav(() => pg.keyboard.press('Enter')); await pg.focus('form.confirm button'); await nav(() => pg.keyboard.press('Enter')); await st('Enter on Confirm button')
}
// finally: keyboard reject (Tab to first stop = Reject, Enter)
await pg.evaluate(() => document.activeElement?.blur()); await pg.keyboard.press('Tab'); R.first_stop = await pg.evaluate(() => document.activeElement?.value)
if (R.first_stop === 'reject') { await nav(() => pg.keyboard.press('Enter')); await st('Tab+Enter (Reject)') }
await b.close(); R.APPLIED = !!R.APPLIED
console.log(JSON.stringify(R, null, 1))
