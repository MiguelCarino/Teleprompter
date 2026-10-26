// Browser pass for P2 (output windows on other monitors): detection and
// the offer, opening an output, the lead handoff, following by words,
// keys in an output, per-output settings, live edits, closing, and a
// reload of the control page while an output keeps reading.
// One headless Chromium, sequential. It serves the repo itself:
//   node tests/outputs.e2e.cjs
// Two monitors are simulated: the Window Management API is replaced in
// the page by a fake with a laptop panel and a 4K monitor.
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { chromium } = require(process.env.PLAYWRIGHT || path.join(__dirname, '../../Topo/tests/node_modules/playwright'));
const results = [];
const ok = (name, cond, info) => { results.push([cond ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)]); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
    return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

const LONG = Array.from({ length: 20 }, (_, i) =>
    `Paragraph ${i + 1}. ` + 'The quick brown fox jumps over the lazy dog while the [camera] keeps rolling and the talent keeps reading. '.repeat(3)
).join('\n\n');

// two screens; permission already granted (so no prompt)
const FAKE_SCREENS = () => {
    const A = { label: 'Built-in Retina', left: 0, top: 0, width: 1280, height: 800, availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 800, isPrimary: true, isInternal: true };
    const B = { label: 'DELL U2720Q', left: 1280, top: 0, width: 3840, height: 2160, availLeft: 1280, availTop: 0, availWidth: 3840, availHeight: 2160, isPrimary: false, isInternal: false };
    Object.defineProperty(screen, 'isExtended', { get: () => true, configurable: true });
    window.getScreenDetails = () => Promise.resolve({ screens: [A, B], currentScreen: A, addEventListener() {} });
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => d && d.name === 'window-management'
        ? Promise.resolve({ state: 'granted', addEventListener() {} }) : q(d);
    window.__opened = [];
    const open = window.open.bind(window);
    window.open = (u, n, f) => { window.__opened.push(f); return open(u, n, f); };
};

(async () => {
    const port = await freePort();
    const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    const BASE = 'http://127.0.0.1:' + port + '/';
    await wait(600);
    const browser = await chromium.launch({ args: ['--disable-gpu'] });
    const errors = [];
    const watch = (p, tag) => {
        p.on('pageerror', (e) => errors.push(tag + ': ' + e));
        p.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
    };
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await ctx.addInitScript(FAKE_SCREENS);
        const page = await ctx.newPage();
        watch(page, 'control');
        await page.goto(BASE, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        // the script goes in through the editor, as a person would type it
        await page.evaluate((t) => {
            const ed = document.getElementById('editor');
            ed.value = t;
            ed.dispatchEvent(new Event('input'));
        }, LONG);
        await wait(900);

        // ---- detection and the offer ----
        const scr = await page.evaluate(() => TP.app.screens());
        ok('two screens listed without a prompt', scr.list.length === 2 && scr.permission === 'granted', scr);
        ok('HUD offers the other screen', await page.locator('#hudOut').isVisible());
        ok('HUD offer names it', (await page.locator('#hudOut').textContent()).includes('other screen'));

        // ---- open on the other screen from the HUD ----
        const [out] = await Promise.all([ctx.waitForEvent('page'), page.click('#hudOut')]);
        watch(out, 'output');
        await out.waitForLoadState('load');
        await out.setViewportSize({ width: 960, height: 540 });
        await wait(1500);
        const feats = await page.evaluate(() => window.__opened);
        ok('opened on the 4K screen', feats.length === 1 && /left=1280/.test(feats[0]) && /width=3840/.test(feats[0]), feats);
        ok('control switched to Controls', await page.evaluate(() => TP.app.mode() === 'control'));
        ok('output has no chrome', (await out.locator('nav, .ws-rail, textarea, .cs-btn').count()) === 0);
        const nP = await out.locator('#screen .tp-p').count();
        ok('output got the script', nP === 20, nP);
        const outId = await out.evaluate(() => TP.out.id);
        ok('output leads the scroll', await page.evaluate(() => TP.app.leadId()) === outId && await out.evaluate(() => TP.out.station.isLead()));
        ok('control follows', await page.evaluate(() => !TP.app.station.isLead()));
        ok('screen name shown in the list', (await page.locator('#outList').textContent()).includes('DELL U2720Q'));
        ok('lead badge shown', (await page.locator('#outList .tp-badge').count()) === 1);
        const ar = await page.evaluate(() => getComputedStyle(document.getElementById('frame')).getPropertyValue('--ar').trim());
        ok('preview takes the output\'s shape', Math.abs(+ar - 960 / 540) < 0.01, ar);

        // ---- play from the control: the output moves, the preview follows ----
        await page.keyboard.press('Space');
        await wait(2500);
        const o1 = await out.evaluate(() => ({ y: TP.out.renderer.y(), playing: TP.out.motion.playing, a: TP.out.renderer.anchor() }));
        const c1 = await page.evaluate(() => ({ a: TP.app.anchor(), st: TP.app.station.status() }));
        ok('output is playing', o1.playing, o1);
        ok('control shows playing', c1.st.playing && c1.st.running, c1.st);
        ok('preview on the same words', Math.abs(o1.a.offset - c1.a.offset) <= 120, { out: o1.a, ctl: c1.a });
        ok('control button says Pause', (await page.locator('#playBtn2').textContent()).trim() === 'Pause');

        // ---- a key in the output window goes through the control ----
        await out.keyboard.press('Space');
        await wait(900);
        ok('Space in the output pauses', !(await out.evaluate(() => TP.out.motion.playing)));
        ok('control knows it paused', !(await page.evaluate(() => TP.app.station.status().playing)));

        // ---- per-output settings ----
        await page.locator('#outList input[type=checkbox]').first().check();
        await wait(300);
        ok('mirror applies to that output', await out.evaluate(() => !!document.querySelector('.tp-flip.tp-mx')));
        ok('this window\'s own mirror is untouched', !(await page.evaluate(() => (JSON.parse(localStorage.getItem('teleprompter:settings')) || {}).mirror)));
        ok('remembered for that screen', await page.evaluate(() => JSON.parse(localStorage.getItem('teleprompter:outputs'))['DELL U2720Q'].mirror === true));

        // text size: same on every output by default; per output when unlinked
        await page.evaluate(() => { const s = document.getElementById('size'); s.value = 90; s.dispatchEvent(new Event('input')); });
        await wait(300);
        ok('same size reaches the output', await out.evaluate(() => TP.out.renderer.settings().size) === 90);
        await page.locator('#sameSize').uncheck();
        await wait(200);
        const slider = page.locator('#outList input[type=range]');
        ok('a size slider per output when unlinked', (await slider.count()) === 1);
        await slider.evaluate((r) => { r.value = 60; r.dispatchEvent(new Event('input')); });
        await wait(300);
        ok('that output alone takes 60 px', await out.evaluate(() => TP.out.renderer.settings().size) === 60);
        ok('the page keeps 90 px for itself', await page.evaluate(() => JSON.parse(localStorage.getItem('teleprompter:settings')).size) === 90);

        // play again, at different sizes the reading line holds the same words
        await page.keyboard.press('Space');
        await wait(3000);
        const o2 = await out.evaluate(() => TP.out.renderer.anchor());
        const c2 = await page.evaluate(() => TP.app.anchor());
        ok('different sizes, same words (within a line)', Math.abs(o2.offset - c2.offset) <= 150, { out: o2, ctl: c2 });

        // ---- a live edit ahead of the reader keeps the reader's place ----
        const before = await out.evaluate(() => TP.out.renderer.anchor().offset);
        await page.keyboard.press('Space');   // pause, to compare exactly
        await wait(800);
        const held = await out.evaluate(() => TP.out.renderer.anchor().offset);
        await page.evaluate(() => {
            const ed = document.getElementById('editor');
            ed.value = ed.value.replace('Paragraph 19.', 'Paragraph nineteen, edited.');
            ed.dispatchEvent(new Event('input'));
        });
        await wait(700);
        ok('edit reaches the output', (await out.locator('#screen').textContent()).includes('nineteen, edited'));
        ok('output did not move for an edit ahead', await out.evaluate(() => TP.out.renderer.anchor().offset) === held, { before, held });

        // ---- identify ----
        await page.locator('#outList button', { hasText: 'Identify' }).click();
        await wait(200);
        ok('identify shows the number', await out.evaluate(() => !document.getElementById('ident').hidden && document.getElementById('ident').textContent === '1'));

        // ---- the control page reloads while the output reads ----
        await page.keyboard.press('Space');
        await wait(600);
        const pre = await out.evaluate(() => ({ playing: TP.out.motion.playing, lead: TP.out.station.isLead(), ended: TP.out.motion.ended }));
        ok('playing before the reload', pre.playing, pre);
        await page.reload({ waitUntil: 'load' });
        await wait(1200);
        const y1 = await out.evaluate(() => TP.out.renderer.y());
        await wait(800);
        const y2 = await out.evaluate(() => TP.out.renderer.y());
        ok('output kept reading through the reload', y2 > y1, { y1, y2 });
        ok('reloaded control found the output again', await page.evaluate(() => TP.app.outputs().length) === 1);
        ok('the output still leads', await page.evaluate(() => TP.app.leadId()) === outId && await out.evaluate(() => TP.out.station.isLead()));
        ok('the control follows it', await page.evaluate(() => TP.app.station.status().playing && !TP.app.station.isLead()));

        // ---- a second output follows the first ----
        await page.evaluate(() => TP.app.setMode('control'));
        const [out2] = await Promise.all([ctx.waitForEvent('page'), page.click('#outOpen')]);
        watch(out2, 'output2');
        await out2.waitForLoadState('load');
        await wait(1500);
        ok('second output listed', await page.evaluate(() => TP.app.outputs().length) === 2);
        ok('second output follows', !(await out2.evaluate(() => TP.out.station.isLead())));
        const a1 = await out.evaluate(() => TP.out.renderer.anchor()), a2 = await out2.evaluate(() => TP.out.renderer.anchor());
        ok('second output on the same words', Math.abs(a1.offset - a2.offset) <= 150, { a1, a2 });

        // ---- the lead closes: the next output takes over and keeps going ----
        await out.close();
        await wait(1500);
        const id2 = await out2.evaluate(() => TP.out.id);
        ok('second output leads now', await page.evaluate(() => TP.app.leadId()) === id2 && await out2.evaluate(() => TP.out.station.isLead()));
        const z1 = await out2.evaluate(() => TP.out.renderer.y());
        await wait(700);
        ok('and keeps scrolling', await out2.evaluate(() => TP.out.renderer.y()) > z1);

        // ---- the last output closes: this window leads again ----
        await page.locator('#outList button', { hasText: 'Close' }).click();
        await wait(1200);
        ok('no outputs left', await page.evaluate(() => TP.app.outputs().length) === 0);
        ok('control leads again', await page.evaluate(() => TP.app.station.isLead() && TP.app.leadId() === 'control'));
        const w1 = await page.evaluate(() => TP.app.renderer.y());
        await wait(600);
        ok('and the scroll carried on here', await page.evaluate(() => TP.app.renderer.y()) > w1);

        ok('no console errors', errors.length === 0, errors);
    } catch (e) {
        ok('no exception', false, String(e && e.stack || e));
    } finally {
        await browser.close();
        server.kill();
    }
    for (const r of results) console.log(r.join('  '));
    const failed = results.filter((r) => r[0] === 'FAIL').length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})();
