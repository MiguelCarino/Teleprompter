// Browser pass for P3 (live editing): headings and stops on the prompter,
// stopping at a stop, the jump list and keys 1–9, a click in the preview,
// Ctrl+Enter in the editor, edits on / above / below the reading line,
// the "you are here" bar, timing and "fit the speed", and the same with
// an output window leading. One headless Chromium, sequential:
//   node tests/p3.e2e.cjs
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

const BODY = 'The quick brown fox jumps over the lazy dog while the [camera] keeps rolling and the talent keeps reading. ';
const SCRIPT = [
    '# Opening',
    'Para one. ' + BODY.repeat(3),
    'Para two. ' + BODY.repeat(3),
    '---',
    '## The middle',
    'Para three. ' + BODY.repeat(3),
    'Para four. ' + BODY.repeat(3),
    '---',
    '# Close',
    'Para five. ' + BODY.repeat(3),
    'Para six. ' + BODY.repeat(3),
].join('\n\n');

// put text in the editor as typing would, and let the 150 ms debounce run
async function setText(page, fn) {
    await page.evaluate((src) => {
        const ed = document.getElementById('editor');
        ed.value = (0, eval)(src)(ed.value);
        ed.dispatchEvent(new Event('input'));
    }, fn.toString());
    await wait(350);
}

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
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const page = await ctx.newPage();
        watch(page, 'control');
        await page.goto(BASE, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => TP.app.setMode('control'));
        await setText(page, new Function('return () => ' + JSON.stringify(SCRIPT))());

        // ---- markup on the prompter ----
        const look = await page.evaluate(() => {
            const h = document.querySelector('#screen .tp-h'), p = document.querySelector('#screen .tp-p:not(.tp-h):not(.tp-stop)');
            const s = document.querySelector('#screen .tp-stop');
            return {
                hText: h && h.textContent, hSize: h && parseFloat(getComputedStyle(h).fontSize), pSize: parseFloat(getComputedStyle(p).fontSize),
                stopH: s && s.offsetHeight, lh: TP.app.renderer.lineHeight(), stopText: s && s.textContent,
                nh: document.querySelectorAll('#screen .tp-h').length, ns: document.querySelectorAll('#screen .tp-stop').length,
            };
        });
        ok('headings drawn without the #', look.hText === 'Opening', look);
        ok('headings drawn smaller', look.hSize < look.pSize * 0.6, look);
        ok('stops are one empty line', look.stopH === look.lh && look.stopText === '', look);
        ok('three headings and two stops', look.nh === 3 && look.ns === 2, look);

        // ---- the jump list ----
        const jl = await page.evaluate(() => [...document.querySelectorAll('#jumps .tp-jump')].map((b) => [b.dataset.kind, b.querySelector('.tp-jump-k').textContent, b.querySelector('.tp-jump-t').textContent]));
        ok('jump list: headings and stops in order', jl.length === 5 && jl.map((x) => x[0]).join() === 'heading,stop,heading,stop,heading', jl);
        ok('jump list numbered 1–5', jl.map((x) => x[1]).join('') === '12345', jl);
        ok('a stop names what follows it', /^Stop · The middle/.test(jl[1][2]), jl[1]);
        ok('"no headings" note hidden', !(await page.locator('#jumpsNone').isVisible()));

        // ---- playing stops at a stop ----
        await page.evaluate(() => { TP.app.motion.setSpeed(3); });
        await page.keyboard.press('Home');
        await wait(200);
        await page.keyboard.press('Space');
        await page.waitForFunction(() => TP.app.player.atStop(), null, { timeout: 15000 }).catch(() => {});
        await wait(700);
        const st1 = await page.evaluate(() => {
            const r = TP.app.renderer, ys = r.stopYs();
            return { y: r.y(), stop: ys[0], at: TP.app.player.atStop(), running: TP.app.player.running(), state: document.getElementById('ctlState').textContent };
        });
        ok('playback rests on the first stop', st1.at && !st1.running && Math.abs(st1.y - st1.stop) < 0.01, st1);
        ok('state says At a stop', st1.state === 'At a stop', st1.state);
        await page.keyboard.press('Space');
        await wait(1500);
        const st2 = await page.evaluate(() => ({ y: TP.app.renderer.y(), stop: TP.app.renderer.stopYs()[0], playing: TP.app.motion.playing }));
        ok('Space carries on past it', st2.playing && st2.y > st2.stop + 10, st2);
        await page.keyboard.press('Space');
        await wait(700);

        // ---- keys 1–9 ----
        await page.keyboard.press('3');
        await wait(600);
        const j3 = await page.evaluate(() => {
            const r = TP.app.renderer, mk = TP.app.marks()[2];
            return { y: r.y(), want: r.yFor({ offset: mk.offset, frac: 0.5 }), cur: [...document.querySelectorAll('#jumps .tp-jump')].findIndex((b) => b.getAttribute('aria-current') === 'true') };
        });
        ok('key 3 jumps to the third mark', Math.abs(j3.y - j3.want) < 0.5, j3);
        ok('the jump list marks where the reader is', j3.cur === 2, j3);
        await page.locator('#jumps .tp-jump').nth(0).click();
        await wait(600);
        const j1 = await page.evaluate(() => ({ y: TP.app.renderer.y(), top: TP.app.renderer.topY() }));
        ok('clicking a jump goes there', Math.abs(j1.y - j1.top) < 0.5, j1);

        // ---- a click in the preview ----
        const target = page.locator('#screen .tp-p').nth(2);
        await target.click();
        await wait(600);
        const pc = await page.evaluate(() => {
            const r = TP.app.renderer, b = TP.app.model().blocks[2];
            return { y: r.y(), want: r.yFor({ offset: b.start, frac: 0.5 }) };
        });
        ok('a click on a preview paragraph jumps there', Math.abs(pc.y - pc.want) < 0.5, pc);

        // ---- Ctrl+Enter in the editor ----
        await page.evaluate(() => {
            const ed = document.getElementById('editor'), k = ed.value.indexOf('Para five.') + 4;
            ed.focus(); ed.setSelectionRange(k, k);
        });
        await page.keyboard.press('Control+Enter');
        await wait(600);
        const ce = await page.evaluate(() => {
            const r = TP.app.renderer, t = TP.app.model().text;
            return { y: r.y(), want: r.yFor({ offset: t.indexOf('Para five.'), frac: 0.5 }), noNewline: !/Para\n five/.test(document.getElementById('editor').value) };
        });
        ok('Ctrl+Enter jumps to the paragraph at the cursor', Math.abs(ce.y - ce.want) < 0.5, ce);
        ok('Ctrl+Enter types nothing', ce.noNewline);
        await page.evaluate(() => document.activeElement.blur());

        // ---- edits and the reading line ----
        // read the second line of "Para three."
        await page.evaluate(() => {
            const r = TP.app.renderer, t = TP.app.model().text, a = t.indexOf('Para three.');
            TP.app.motion.seek(TP.app.player.posFromY(r.yFor({ offset: a, frac: 0.5 }) + r.lineHeight()));
            r.setY(TP.app.player.yFromPos(TP.app.motion.pos));
            TP.app.player.kick();   // as any transport action does: the readouts and the bar update
        });
        await wait(300);
        const r0 = await page.evaluate(() => ({ y: TP.app.renderer.y(), rd: TP.app.renderer.reading(), t: TP.app.model().text }));
        const lineText = r0.t.slice(r0.rd.line[0], r0.rd.line[1]);
        ok('reading() names the line being read', /fox|dog|camera|talent|quick|lazy/.test(lineText) && r0.rd.line[0] > r0.rd.para[0], lineText);

        // the "you are here" bar shows that line
        const bar = await page.evaluate(() => {
            const m = document.querySelector('#edBack .tp-here-line'), ed = document.getElementById('editor'), bk = document.getElementById('edBack');
            return { text: m && m.textContent, para: !!document.querySelector('#edBack .tp-here-para'), sh: [bk.scrollHeight, ed.scrollHeight], st: [bk.scrollTop, ed.scrollTop],
                visible: m && m.offsetTop >= ed.scrollTop && m.offsetTop < ed.scrollTop + ed.clientHeight };
        });
        ok('the bar marks the line being read', bar.text === lineText, { bar: bar.text, lineText });
        ok('the bar wraps like the editor (same height)', Math.abs(bar.sh[0] - bar.sh[1]) <= 2, bar.sh);
        ok('the bar is scrolled into view', bar.visible && bar.st[0] === bar.st[1], bar);

        // an edit in the middle of the line being read: same y
        const mid = r0.rd.line[0] + Math.floor((r0.rd.line[1] - r0.rd.line[0]) / 2);
        await setText(page, new Function('return (v) => v.slice(0, ' + mid + ') + "INSERTED WORDS " + v.slice(' + mid + ')')());
        const r1 = await page.evaluate(() => ({ y: TP.app.renderer.y(), rd: TP.app.renderer.reading(), t: TP.app.model().text }));
        ok('an edit on the reading line keeps the line in place', Math.abs(r1.y - r0.y) < 0.01, { before: r0.y, after: r1.y });
        ok('the reading line now shows the edit', r1.t.slice(r1.rd.line[0], r1.rd.line[1]).includes('INSERTED') || r1.t.slice(r1.rd.line[0], r1.rd.line[1] + 20).includes('INSERTED'), r1.t.slice(r1.rd.line[0], r1.rd.line[1]));
        // a long edit there: the paragraph wraps to more lines; the line stays put
        const lines0 = await page.evaluate(() => TP.app.renderer.lineCount());
        await setText(page, new Function('return (v) => v.replace("INSERTED WORDS ", "INSERTED WORDS " + "and many more words to read here ".repeat(8))')());
        const r2 = await page.evaluate(() => ({ y: TP.app.renderer.y(), n: TP.app.renderer.lineCount() }));
        ok('a longer line: more lines below, the reading line stays', r2.n > lines0 && Math.abs(r2.y - r0.y) < 0.01, { lines0, r2, y0: r0.y });
        // typing at the start of the reading line
        const rs = await page.evaluate(() => TP.app.renderer.reading().line[0]);
        await setText(page, new Function('return (v) => v.slice(0, ' + rs + ') + "Start " + v.slice(' + rs + ')')());
        ok('typing at the start of the line keeps it in place', Math.abs(await page.evaluate(() => TP.app.renderer.y()) - r0.y) < 0.01);
        // an edit ahead: no change at all
        const a3 = await page.evaluate(() => ({ y: TP.app.renderer.y(), a: TP.app.renderer.anchor() }));
        await setText(page, (v) => v.replace('Para six.', 'Para six, with a much longer opening sentence than before.'));
        const a4 = await page.evaluate(() => ({ y: TP.app.renderer.y(), a: TP.app.renderer.anchor() }));
        ok('an edit ahead never moves the reading line', a4.y === a3.y && a4.a.offset === a3.a.offset, { a3, a4 });
        // an edit above (an earlier paragraph grows): the same words stay on the reading line
        const w0 = await page.evaluate(() => { const t = TP.app.model().text, rd = TP.app.renderer.reading(); return t.slice(rd.line[0], rd.line[1]); });
        await setText(page, (v) => v.replace('Para one.', 'Para one, and a long new sentence at its start that wraps onto more lines of the prompter than it did.'));
        const w1 = await page.evaluate(() => { const t = TP.app.model().text, rd = TP.app.renderer.reading(); return t.slice(rd.line[0], rd.line[1]); });
        ok('an edit above keeps the same words on the reading line', w0 === w1, { w0, w1 });

        // ---- timing ----
        const tm = await page.evaluate(() => ({ left: document.getElementById('ctlLeft').textContent, total: document.getElementById('ctlTotal').textContent, hud: document.getElementById('hudLeft').textContent }));
        ok('remaining and total shown', /≈ \d+:\d\d left/.test(tm.left) && /≈ \d+:\d\d in all/.test(tm.total) && /^−\d+:\d\d$/.test(tm.hud), tm);
        await page.locator('#fitBtn').click();
        ok('fit without a target asks for one', (await page.locator('#targetNote').textContent()).includes('target length'));
        ok('and puts the cursor in the target field', await page.evaluate(() => document.activeElement.id === 'target'));
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press('Home');
        await wait(300);
        await page.fill('#target', '1:30');
        await page.locator('#target').press('Tab');
        await wait(100);
        ok('a target shows over or under', /over target|under target|On target/.test(await page.locator('#ctlTarget').textContent()));
        await page.locator('#fitBtn').click();
        await wait(200);
        const fit = await page.evaluate(() => ({ sp: TP.app.motion.speed, sl: TP.app.motion.max, tg: document.getElementById('ctlTarget').textContent, total: document.getElementById('ctlTotal').textContent }));
        ok('fit sets the speed that ends on the target', Math.abs(fit.sl / fit.sp - 90) < 2, fit);
        ok('then it reads On target', fit.tg === 'On target', fit);
        ok('the target is saved', await page.evaluate(() => JSON.parse(localStorage.getItem('teleprompter:settings')).target === 90));
        await page.fill('#target', 'soon');
        await page.locator('#target').press('Tab');
        ok('a bad length is explained', (await page.locator('#targetNote').textContent()).includes('3:30'));

        // ---- headings hidden ----
        await page.selectOption('#headings', 'hidden');
        await wait(300);
        ok('hidden headings are not drawn', await page.evaluate(() => document.querySelectorAll('#screen .tp-h').length === 0 && document.querySelectorAll('#screen .tp-stop').length === 2));
        await page.keyboard.press('5');
        await wait(600);
        const hj = await page.evaluate(() => {
            const r = TP.app.renderer, t = TP.app.model().text;
            return { y: r.y(), want: r.yFor({ offset: t.indexOf('Para five.'), frac: 0.5 }) };
        });
        ok('a jump to a hidden heading lands on what follows it', Math.abs(hj.y - hj.want) < 0.5, hj);
        await page.selectOption('#headings', 'small');
        await wait(200);

        // ---- with an output window leading ----
        await page.evaluate(() => { const s = document.getElementById('size'); s.value = 40; s.dispatchEvent(new Event('input')); });
        const [out] = await Promise.all([ctx.waitForEvent('page'), page.click('#outOpen')]);
        watch(out, 'output');
        await out.waitForLoadState('load');
        await out.setViewportSize({ width: 540, height: 960 });   // portrait, wraps differently
        await wait(1500);
        ok('the output leads', await out.evaluate(() => TP.out.station.isLead()));
        ok('the output draws headings and stops', await out.evaluate(() => document.querySelectorAll('.tp-h').length === 3 && document.querySelectorAll('.tp-stop').length === 2));
        await page.keyboard.press('1');
        await wait(800);
        await page.evaluate(() => TP.app.motion.setSpeed(3));
        await page.evaluate(() => { const s = document.getElementById('speed'); s.value = 3; s.dispatchEvent(new Event('input')); });
        await page.keyboard.press('Space');
        await out.waitForFunction(() => TP.out.player.atStop(), null, { timeout: 30000 }).catch(() => {});
        await wait(900);
        const os = await out.evaluate(() => ({ at: TP.out.player.atStop(), y: TP.out.renderer.y(), stop: TP.out.renderer.stopYs()[0] }));
        ok('the lead output rests on the stop', os.at && Math.abs(os.y - os.stop) < 0.01, os);
        ok('the control says At a stop', (await page.locator('#ctlState').textContent()) === 'At a stop');
        // an edit on the output's reading line: the output's line stays put
        const oy0 = await out.evaluate(() => ({ y: TP.out.renderer.y(), rd: TP.out.renderer.reading() }));
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await wait(800);
        const oy1 = await out.evaluate(() => ({ y: TP.out.renderer.y(), rd: TP.out.renderer.reading() }));
        const omid = oy1.rd.line[0] + 3;
        await setText(page, new Function('return (v) => v.slice(0, ' + omid + ') + "LIVE FIX " + v.slice(' + omid + ')')());
        await wait(300);
        const oy2 = await out.evaluate(() => ({ y: TP.out.renderer.y(), has: document.body.textContent.includes('LIVE FIX') }));
        ok('an edit on the output\'s reading line keeps it in place', oy2.has && Math.abs(oy2.y - oy1.y) < 0.01, { oy0: oy0.y, oy1: oy1.y, oy2 });
        // keys 1–9 pressed in the output go through the control
        await out.keyboard.press('4');
        await wait(900);
        const ok4 = await out.evaluate(() => {
            const t = document.body.textContent, r = TP.out.renderer;
            return { y: r.y(), stop: r.stopYs()[1] };
        });
        ok('key 4 in the output jumps it to the second stop', Math.abs(ok4.y - ok4.stop) < 0.5, ok4);

        ok('no page errors', errors.length === 0, errors);
    } catch (e) {
        ok('suite ran to the end', false, String(e && e.stack || e));
    } finally {
        await browser.close();
        server.kill();
    }
    for (const r of results) console.log(r[0] + '  ' + r[1] + (r[0] === 'FAIL' && r[2] ? '  ' + r[2] : ''));
    const fails = results.filter((r) => r[0] === 'FAIL').length;
    console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
    process.exit(fails ? 1 : 0);
})();
