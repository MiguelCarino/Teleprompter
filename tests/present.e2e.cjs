// Browser pass for P1 (Present here, controls, persistence, anchor through
// size changes, flip, countdown, edits, phone width, storage blocked).
// One headless Chromium, sequential. It serves the repo itself:
//   node tests/present.e2e.cjs
// Playwright comes from the Topo repository's test rig, checked out next to
// this one (override with PLAYWRIGHT=/path/to/playwright).
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { chromium } = require(process.env.PLAYWRIGHT || path.join(__dirname, '../../Topo/tests/node_modules/playwright'));
const results = [];
const ok = (name, cond, info) => { results.push([cond ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)]); };
function freePort() {
    return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

const LONG = Array.from({ length: 12 }, (_, i) =>
    `Paragraph ${i + 1}. ` + 'The quick brown fox jumps over the lazy dog while the [camera] keeps rolling and the talent keeps reading. '.repeat(3)
).join('\n\n');

(async () => {
    const port = await freePort();
    const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    const BASE = 'http://127.0.0.1:' + port + '/';
    await new Promise((r) => setTimeout(r, 600));
    const browser = await chromium.launch({ args: ['--disable-gpu'] });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

        await page.goto(BASE, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);

        // ---- Present here first ----
        ok('opens in present mode', await page.evaluate(() => document.body.classList.contains('present') && TP.app.mode() === 'present'));
        ok('navbar exists but is not visible', (await page.locator('#carinoNav').count()) === 1 && !(await page.locator('#carinoNav').isVisible()));
        ok('rail not visible', !(await page.locator('.ws-rail').isVisible()));
        ok('editor not visible', !(await page.locator('#editor').isVisible()));
        const box = await page.locator('#screen').boundingBox();
        ok('screen fills the window', box && box.x === 0 && box.y === 0 && box.width === 1280 && box.height === 800, box);
        ok('HUD visible at first', await page.locator('#hud').isVisible());
        ok('sample text rendered', (await page.locator('#screen .tp-p').count()) >= 4);
        ok('cues are spans', (await page.locator('#screen .tp-cue').count()) >= 4);
        // the HUD fades and the cursor hides when idle
        await page.waitForTimeout(4300);
        ok('HUD fades after idle', !(await page.locator('#hud').isVisible()));
        ok('cursor hidden after idle', await page.evaluate(() => document.body.classList.contains('idle')));
        await page.mouse.move(300, 300); await page.mouse.move(320, 310);
        await page.waitForTimeout(250);
        ok('mouse move brings the HUD back', await page.locator('#hud').isVisible());

        // ---- motion: time-based, sub-pixel translate, no scrollTop ----
        const y0 = await page.evaluate(() => TP.app.renderer.y());
        await page.keyboard.press('Space');
        await page.waitForTimeout(1500);
        const mid = await page.evaluate(() => ({ y: TP.app.renderer.y(), playing: TP.app.motion.playing, tf: document.querySelector('.tp-track').style.transform, st: document.querySelector('.tp-out').scrollTop }));
        ok('Space plays and the text moves', mid.playing && mid.y > y0, mid);
        ok('motion uses translate3d, scrollTop stays 0', /translate3d\(0px?, ?-?[\d.]+px, ?0px?\)/.test(mid.tf) && mid.st === 0, mid.tf);
        await page.keyboard.press('Space');
        await page.waitForTimeout(700);
        const st = await page.evaluate(() => ({ playing: TP.app.motion.playing, active: TP.app.motion.isActive() }));
        ok('Space pauses (eases to a stop)', !st.playing && !st.active, st);
        // fractional positions occur
        const fracs = await page.evaluate(async () => {
            TP.app.motion.setSpeed(0.2); TP.app.motion.play();
            const out = [];
            for (let i = 0; i < 20; i++) { await new Promise((r) => requestAnimationFrame(r)); out.push(document.querySelector('.tp-track').style.transform); }
            TP.app.motion.pause();
            return out;
        });
        ok('sub-pixel transforms while slow', fracs.some((t) => /\.\d/.test(t)), fracs.slice(-3));
        await page.waitForTimeout(700);

        // keys: PgDn, Home, R, arrows
        await page.keyboard.press('PageDown'); await page.waitForTimeout(450);
        const afterPg = await page.evaluate(() => TP.app.motion.pos);
        ok('PgDn jumps a paragraph', afterPg >= 1, afterPg);
        await page.keyboard.press('Home'); await page.waitForTimeout(100);
        ok('Home goes to the top', await page.evaluate(() => TP.app.motion.pos === 0));
        const sp = await page.evaluate(() => TP.app.motion.speed);
        await page.keyboard.press('ArrowUp');
        ok('ArrowUp raises speed', await page.evaluate((s) => TP.app.motion.speed > s, sp));
        await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350);
        ok('ArrowRight nudges one line', await page.evaluate(() => Math.abs(TP.app.motion.pos - 1) < 1e-6));
        await page.keyboard.press('r');
        ok('R reverses', await page.evaluate(() => TP.app.motion.direction === -1));
        await page.keyboard.press('r');

        // end state
        await page.evaluate(() => { const m = TP.app.motion; m.seek(m.max - 0.3); m.setSpeed(3); });
        await page.keyboard.press('Space');
        await page.waitForTimeout(1500);
        const end = await page.evaluate(() => ({ ended: TP.app.motion.ended, cls: document.querySelector('.tp-out').classList.contains('tp-ended'), label: document.getElementById('hudPlay').textContent }));
        ok('reaching the end shows the end state', end.ended && end.cls && /top/i.test(end.label), end);
        await page.keyboard.press('Space');   // = Back to top
        await page.waitForTimeout(100);
        ok('Space at the end goes back to the top', await page.evaluate(() => TP.app.motion.pos === 0 && !TP.app.motion.ended));
        await page.evaluate(() => TP.app.motion.setSpeed(+document.getElementById('speed').value));

        // reverse playback to the top, then Space plays forward again
        await page.evaluate(() => TP.app.motion.seek(1.2));
        await page.keyboard.press('r'); await page.keyboard.press('Space');
        await page.waitForTimeout(3200);
        const rt0 = await page.evaluate(() => ({ pos: TP.app.motion.pos, playing: TP.app.motion.playing, dir: TP.app.motion.direction, btn: document.getElementById('hudPlay').textContent }));
        ok('reverse stops at the top and turns forward', rt0.pos === 0 && !rt0.playing && rt0.dir === 1 && rt0.btn === 'Play', rt0);
        await page.keyboard.press('Space'); await page.waitForTimeout(1200);
        const rt1 = await page.evaluate(() => ({ pos: TP.app.motion.pos, playing: TP.app.motion.playing }));
        ok('Space after reverse-to-top plays', rt1.playing && rt1.pos > 0.1, rt1);
        await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(500);
        const rt2 = await page.evaluate(() => ({ pos: TP.app.motion.pos, playing: TP.app.motion.playing }));
        ok('a backward nudge near the top keeps playing', rt2.playing && rt2.pos >= 0, rt2);
        await page.keyboard.press('Home');
        await page.keyboard.press('r'); await page.keyboard.press('Space'); await page.waitForTimeout(800);
        const rt3 = await page.evaluate(() => ({ pos: TP.app.motion.pos, playing: TP.app.motion.playing, dir: TP.app.motion.direction }));
        ok('R then Space at the top plays forward', rt3.playing && rt3.dir === 1 && rt3.pos > 0, rt3);
        await page.keyboard.press('Home');

        // double-click for fullscreen selects nothing
        await page.mouse.dblclick(640, 320);
        await page.waitForTimeout(250);
        const dc = await page.evaluate(() => ({ sel: String(getSelection()), us: getComputedStyle(document.querySelector('.tp-out')).userSelect, fs: !!document.fullscreenElement }));
        ok('double-click leaves no text selection on the output', dc.sel === '' && dc.us === 'none', dc);
        // leaving fullscreen the page did not ask for (the browser's Esc) opens the controls
        if (dc.fs) {
            await page.evaluate(() => document.exitFullscreen());
            await page.waitForTimeout(250);
            ok('Esc out of fullscreen opens the controls', await page.evaluate(() => TP.app.mode() === 'control'));
            await page.evaluate(() => TP.app.setMode('present'));
        } else ok('fullscreen available in headless (skip Esc check)', true, 'no fullscreen');
        // F into and out of fullscreen stays in present
        await page.keyboard.press('f'); await page.waitForTimeout(250);
        await page.keyboard.press('f'); await page.waitForTimeout(250);
        ok('F out of fullscreen stays in present', await page.evaluate(() => TP.app.mode() === 'present'));

        // the HUD has no gold on the reader's screen
        ok('HUD has no primary (gold) button', (await page.locator('#hud .primary').count()) === 0);

        // ---- Controls ----
        await page.mouse.move(400, 400); await page.mouse.move(410, 400);
        await page.locator('#hudCtl').click();
        await page.waitForTimeout(200);
        ok('Controls button opens the control surface', await page.evaluate(() => !document.body.classList.contains('present')));
        ok('navbar visible in controls', await page.locator('#carinoNav').isVisible());
        ok('rail visible in controls', await page.locator('.ws-rail').isVisible());
        ok('screen sits in the preview frame', await page.evaluate(() => document.getElementById('screen').parentElement.id === 'frame'));
        const pf = await page.locator('#frame').boundingBox();
        const ps = await page.locator('#screen').boundingBox();
        ok('preview is the scaled output', pf && ps && Math.abs(pf.width - ps.width) < 2 && Math.abs(pf.height - ps.height) < 2, { pf, ps });

        // a checkbox clicked with the mouse lets go of focus: Space plays
        await page.click('label.check:has(#mirror)');
        const cb = await page.evaluate(() => ({ m: document.getElementById('mirror').checked, focus: document.activeElement.id }));
        ok('clicking a checkbox does not keep focus', cb.m && cb.focus !== 'mirror', cb);
        await page.keyboard.press('Space'); await page.waitForTimeout(300);
        const cb2 = await page.evaluate(() => ({ m: document.getElementById('mirror').checked, play: TP.app.motion.playing }));
        ok('Space after a checkbox click plays and leaves it checked', cb2.m && cb2.play, cb2);
        await page.keyboard.press('Space'); await page.waitForTimeout(700);
        await page.click('label.check:has(#mirror)');
        // keyboard focus on a checkbox: Space toggles it, the arrows still nudge
        await page.focus('#flip');
        await page.keyboard.press('Space');
        ok('keyboard Space on a focused checkbox toggles it', await page.evaluate(() => document.getElementById('flip').checked && !TP.app.motion.playing));
        await page.keyboard.press('Space');
        const p0 = await page.evaluate(() => TP.app.motion.pos);
        await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350);
        ok('arrows still nudge with a checkbox focused', await page.evaluate((p) => Math.abs(TP.app.motion.pos - p - 1) < 1e-6, p0));
        await page.keyboard.press('Home');
        await page.evaluate(() => document.activeElement.blur());
        // the drop zone: a click opens the picker once, then Space plays
        let choosers = 0;
        page.on('filechooser', () => { choosers++; });
        await page.click('#dropZone');
        await page.waitForTimeout(200);
        await page.keyboard.press('Space'); await page.waitForTimeout(300);
        const dz = await page.evaluate(() => ({ focus: document.activeElement.id, play: TP.app.motion.playing }));
        ok('drop zone click: picker once, then Space plays', choosers === 1 && dz.play && dz.focus !== 'dropZone', { choosers, dz });
        await page.keyboard.press('Home');

        // edit
        await page.locator('#editor').fill(LONG);
        await page.waitForTimeout(600);
        ok('edit re-renders the preview', (await page.locator('#screen .tp-p').count()) === 12);
        ok('script is not markup', await page.evaluate(() => document.querySelectorAll('#screen img, #screen script').length === 0));
        // paste is a normal paste: insert in the middle keeps the rest
        await page.locator('#editor').focus();
        await page.evaluate(() => { const e = document.getElementById('editor'); e.setSelectionRange(10, 10); });
        await page.keyboard.insertText('INSERTED ');
        await page.waitForTimeout(500);
        const val0 = await page.locator('#editor').inputValue();
        ok('typing/pasting in the middle keeps the script', val0.length === LONG.length + 9 && val0.includes('INSERTED') && val0.endsWith(LONG.slice(-30)));
        // keys are ignored while typing
        await page.keyboard.press('Space');
        const val = await page.locator('#editor').inputValue();
        ok('Space in the editor types, does not play', val.length === val0.length + 1 && await page.evaluate(() => !TP.app.motion.playing));
        await page.waitForTimeout(500);
        await page.evaluate(() => document.activeElement.blur());

        // a setting
        await page.locator('#spacing').evaluate((el) => { el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForTimeout(700);   // save debounce

        // ---- persistence ----
        await page.reload({ waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const v2 = await page.evaluate(() => ({ text: document.getElementById('editor').value, spacing: document.getElementById('spacing').value, mode: TP.app.mode(), paras: document.querySelectorAll('#screen .tp-p').length }));
        ok('reload keeps the script', v2.text === val, v2.text.slice(0, 40));
        ok('reload keeps settings', v2.spacing === '1.5', v2.spacing);
        ok('reload opens in present again with the saved script', v2.mode === 'present' && v2.paras === 12, v2);

        // ---- text size change keeps the anchor on the same words ----
        for (const mode of ['present', 'control']) {
            if (mode === 'control') await page.evaluate(() => TP.app.setMode('control'));
            await page.evaluate(() => { const m = TP.app.motion; m.seek(Math.round(m.max * 0.45)); TP.app.renderer.setY(TP.app.renderer.topY() + m.pos * TP.app.renderer.lineHeight()); });
            await page.waitForTimeout(100);
            const before = await page.evaluate(() => {
                const r = TP.app.renderer, a = r.anchor(), text = document.getElementById('editor').value;
                return { a, words: text.slice(a.offset, a.offset + 12), size: +document.getElementById('size').value };
            });
            for (const size of [before.size + 60, Math.max(30, before.size - 40)]) {
                await page.locator('#size').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, size);
                await page.waitForTimeout(150);
                const after = await page.evaluate((old) => {
                    const r = TP.app.renderer, a = r.anchor(), lh = r.lineHeight();
                    const yOld = r.yFor({ offset: old.offset, frac: 0.5 });
                    return { a, lh, dy: Math.abs(yOld - r.y()), posSynced: Math.abs(r.topY() + TP.app.motion.pos * lh - r.y()) < 0.01 };
                }, before.a);
                ok(`[${mode}] size ${before.size}→${size}: old anchor's line is on the reading line`, after.dy <= after.lh / 2 + 1, after);
                ok(`[${mode}] size ${size}: motion resynced to the renderer`, after.posSynced);
            }
            // visual check: the text at the reading line holds the first word of the old line
            const seen = await page.evaluate(() => {
                const scr = document.getElementById('screen').getBoundingClientRect();
                const r = TP.app.renderer, s = r.settings();
                const k = scr.width / document.getElementById('screen').offsetWidth;
                const y = scr.top + (scr.height * s.linePos / 100);
                const words = new Set();
                for (let x = scr.left + scr.width * 0.1; x < scr.right - scr.width * 0.1; x += 4 * k) {
                    const cr = document.caretRangeFromPoint(x, y);
                    if (!cr || cr.startContainer.nodeType !== 3) continue;
                    const t = cr.startContainer.textContent; let a = cr.startOffset, b = cr.startOffset;
                    while (a > 0 && !/\s/.test(t[a - 1])) a--;
                    while (b < t.length && !/\s/.test(t[b])) b++;
                    if (b > a) words.add(t.slice(a, b));
                }
                return [...words].join(' ');
            });
            ok(`[${mode}] the old words are what is on the reading line`, seen.split(' ').includes(before.words.trim().split(/\s+/)[0]), { seen: seen.slice(0, 80), words: before.words });
        }

        // ---- flipped + mirrored: the mapping still holds ----
        await page.evaluate(() => { for (const id of ['mirror', 'flip', 'dim']) { const c = document.getElementById(id); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } });
        await page.waitForTimeout(100);
        const fl = await page.evaluate(() => ({ cls: document.querySelector('.tp-flip').className, dim: !document.querySelector('.tp-dim').hidden, a: TP.app.renderer.anchor() }));
        ok('mirror + flip + dim applied', /tp-mx/.test(fl.cls) && /tp-fy/.test(fl.cls) && fl.dim, fl);
        await page.locator('#size').evaluate((el) => { el.value = '150'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForTimeout(150);
        const fl2 = await page.evaluate((old) => { const r = TP.app.renderer; return { dy: Math.abs(r.yFor({ offset: old.offset, frac: 0.5 }) - r.y()), lh: r.lineHeight(), a: r.anchor() }; }, fl.a);
        ok('flipped: a size change keeps the anchor line on the reading line', fl2.dy <= fl2.lh / 2 + 1, fl2);
        // anchor round trip while flipped (lineOf uses the flipped ratio)
        const rt = await page.evaluate(() => { const r = TP.app.renderer, out = []; for (const f of [0.2, 0.5, 0.8]) { const ys = r.paraYs(); const y = ys[3] + r.lineHeight() * (1 + f - 0.5); const a = r.anchorAt(y); out.push(Math.abs(r.yFor(a) - y)); } return out; });
        ok('flipped: anchor ⇄ y round-trips', rt.every((d) => d < 0.01), rt);
        await page.evaluate(() => { for (const id of ['mirror', 'flip', 'dim']) { const c = document.getElementById(id); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); } });

        // the end state survives a bigger text size
        await page.evaluate(() => { const m = TP.app.motion; m.seek(m.max - 0.2); TP.app.player.play(); });
        await page.waitForTimeout(1200);
        ok('setup: at the end', await page.evaluate(() => TP.app.motion.ended));
        await page.locator('#size').evaluate((el) => { el.value = String(+el.value + 40); el.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForTimeout(200);
        const eg = await page.evaluate(() => ({ ended: TP.app.motion.ended, pos: TP.app.motion.pos, max: TP.app.motion.max, out: document.querySelector('.tp-out').classList.contains('tp-ended'), btn: document.getElementById('playBtn2').textContent }));
        ok('end state kept through a size change', eg.ended && eg.pos === eg.max && eg.out && eg.btn === 'Back to top', eg);
        // back to the middle for the edit checks
        await page.evaluate(() => { const m = TP.app.motion; TP.app.player.top(); m.seek(Math.round(m.max * 0.45)); TP.app.player.kick(); });
        await page.waitForTimeout(150);

        // ---- an edit ahead of / above the anchor does not move the reading line ----
        const ed0 = await page.evaluate(() => ({ a: TP.app.renderer.anchor(), text: document.getElementById('editor').value }));
        const word0 = ed0.text.slice(ed0.a.offset, ed0.a.offset + 20);
        await page.evaluate(() => { const e = document.getElementById('editor'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); });
        await page.keyboard.insertText(' Added at the very end.');
        await page.waitForTimeout(400);
        const ed1 = await page.evaluate(() => TP.app.renderer.anchor());
        ok('an edit after the anchor keeps the anchor', ed1.offset === ed0.a.offset && Math.abs(ed1.frac - ed0.a.frac) < 1e-9, { ed0: ed0.a, ed1 });
        await page.evaluate(() => { const e = document.getElementById('editor'); e.setSelectionRange(0, 0); });
        await page.keyboard.insertText('Opening line. ');
        await page.waitForTimeout(400);
        const ed2 = await page.evaluate(() => { const a = TP.app.renderer.anchor(); return { a, at: document.getElementById('editor').value.slice(a.offset, a.offset + 20) }; });
        ok('an edit before the anchor shifts it with the text', ed2.at === word0, { word0, ed2 });
        await page.evaluate(() => document.activeElement.blur());

        // ---- countdown ----
        await page.evaluate(() => { const c = document.getElementById('countdown'); c.value = '3'; c.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.keyboard.press('Home');
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);
        const cd = await page.evaluate(() => ({ shown: !document.querySelector('.tp-count').hidden, n: document.querySelector('.tp-count').textContent, playing: TP.app.motion.playing, state: document.getElementById('ctlState').dataset.state }));
        ok('countdown shows on the output before playing', cd.shown && cd.n === '3' && !cd.playing && cd.state === 'countdown', cd);
        await page.waitForTimeout(3000);
        const cd2 = await page.evaluate(() => ({ hidden: document.querySelector('.tp-count').hidden, playing: TP.app.motion.playing }));
        ok('countdown ends and playback starts', cd2.hidden && cd2.playing, cd2);
        await page.keyboard.press('Space');
        await page.evaluate(() => { const c = document.getElementById('countdown'); c.value = '0'; c.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(600);

        // ---- Present button returns ----
        await page.locator('#presentBtn').click();
        await page.waitForTimeout(150);
        ok('Present button goes back to present', await page.evaluate(() => TP.app.mode() === 'present') && !(await page.locator('.ws-rail').isVisible()));

        // ---- languages ----
        const langs = await page.evaluate(async () => {
            const out = {};
            for (const l of ['es', 'ja', 'ru', 'pt-BR']) {
                window.CarinoLang.set(l);
                await new Promise((r) => setTimeout(r, 50));
                out[l] = document.getElementById('hudCtl').textContent;
            }
            return out;
        });
        ok('HUD translates', langs.es === 'Controles' && langs.ja === '操作画面' && langs.ru === 'Управление', langs);

        ok('no page errors', errors.length === 0, errors);
        await ctx.close();

        // ---- sample is translated, and the page works when storage throws ----
        const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        await ctx2.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
        });
        const p2 = await ctx2.newPage();
        const errs2 = [];
        p2.on('pageerror', (e) => errs2.push(String(e)));
        await p2.goto(BASE, { waitUntil: 'load' });
        await p2.waitForTimeout(400);
        ok('[no storage] present still renders', (await p2.locator('#screen .tp-p').count()) >= 4);
        await p2.evaluate(() => TP.app.setMode('control'));
        await p2.waitForTimeout(300);
        const sw = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth }));
        ok('[phone] no horizontal scroll on the control surface', sw.sw <= sw.iw && sw.bw <= sw.iw, sw);
        const pane = await p2.locator('.ws-pane').boundingBox();
        ok('[phone] 16px side gutter', pane && (await p2.evaluate(() => getComputedStyle(document.querySelector('.ws-pane')).paddingLeft)) === '16px', pane);
        const fr = await p2.evaluate(() => { const f = document.getElementById('frame').getBoundingClientRect(), p = document.querySelector('.tp-view').getBoundingClientRect(); return { l: f.left - p.left, r: p.right - f.right, h: f.height, ih: innerHeight }; });
        ok('[phone] preview centred and shorter than the screen', Math.abs(fr.l - fr.r) < 2 && fr.h < fr.ih * 0.5, fr);
        await p2.locator('#editor').fill('Phone script.\n\nSecond paragraph.');
        await p2.waitForTimeout(400);
        ok('[no storage] editing still works', (await p2.locator('#screen .tp-p').count()) === 2);
        ok('[no storage] no page errors', errs2.length === 0, errs2);
        await ctx2.close();

        // desktop: present → Esc → wide controls, then the sample follows the language
        const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const p3 = await ctx3.newPage();
        await p3.goto(BASE, { waitUntil: 'load' });
        await p3.evaluate(() => document.fonts.ready);
        await p3.waitForTimeout(300);
        await p3.keyboard.press('Escape');
        await p3.waitForTimeout(300);
        await p3.setViewportSize({ width: 1600, height: 900 });
        await p3.waitForTimeout(300);
        // the sample follows the language
        const ja = await p3.evaluate(async () => { CarinoLang.set('ja'); await new Promise((r) => setTimeout(r, 80)); return { ed: document.getElementById('editor').value.slice(0, 8), out: document.querySelector('#screen .tp-p').textContent.slice(0, 8), end: document.querySelector('.tp-end').textContent }; });
        ok('sample script is translated (editor and output)', ja.ed.startsWith('サンプル') && ja.out.startsWith('サンプル') && ja.end === '原稿の終わり', ja);
        // the language follows without losing the place or stopping
        await p3.evaluate(() => TP.app.setMode('present'));
        await p3.keyboard.press('PageDown'); await p3.waitForTimeout(450);
        await p3.keyboard.press('PageDown'); await p3.waitForTimeout(450);
        await p3.keyboard.press('Space'); await p3.waitForTimeout(600);
        const lg = await p3.evaluate(async () => {
            const m = TP.app.motion, para = () => TP.model.blockIndexAt(TP.model.parse(document.getElementById('editor').value).blocks, TP.app.anchor().offset);
            const before = { para: para(), pos: m.pos };
            CarinoLang.set('es'); await new Promise((r) => setTimeout(r, 80));
            return { before, after: { para: para(), pos: m.pos, playing: m.playing, ed: document.getElementById('editor').value.slice(0, 5) } };
        });
        ok('language change keeps the sample paragraph and playback', lg.after.ed === 'Guion' && lg.after.para === lg.before.para && lg.after.playing && lg.after.pos > 1, lg);
        await p3.keyboard.press('Space'); await p3.waitForTimeout(700);
        const keep = await p3.evaluate(() => TP.model.blockIndexAt(TP.model.parse(document.getElementById('editor').value).blocks, TP.app.anchor().offset));
        await p3.reload({ waitUntil: 'load' });
        await p3.evaluate(() => document.fonts.ready); await p3.waitForTimeout(300);
        const rl = await p3.evaluate(() => ({ ed: document.getElementById('editor').value.slice(0, 5), out: document.querySelector('#screen .tp-p').textContent.slice(0, 5), para: TP.model.blockIndexAt(TP.model.parse(document.getElementById('editor').value).blocks, TP.app.anchor().offset), pos: TP.app.motion.pos }));
        ok('reload in Spanish keeps the sample position', rl.ed === 'Guion' && rl.out === 'Guion' && rl.para === keep && rl.pos > 1, { keep, rl });
        await p3.evaluate(() => CarinoLang.set('auto'));
        await ctx3.close();
    } finally {
        await browser.close();
        server.kill();
    }
    for (const r of results) console.log(r.join('  '));
    const fails = results.filter((r) => r[0] === 'FAIL').length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
