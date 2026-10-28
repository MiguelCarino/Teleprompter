// node --test tests/ — the multi-window pieces that need no browser:
// the channel filter, following by paragraph place, the lead handoff, screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const link = require('../prompter/link.js');
const station = require('../prompter/station.js');
const screens = require('../prompter/screens.js');

// A fake BroadcastChannel bus: every channel of the same name hears the others.
function bus() {
    const all = [];
    return class {
        constructor() { all.push(this); this.onmessage = null; }
        postMessage(data) { for (const c of all) if (c !== this && c.onmessage) c.onmessage({ data: structuredClone(data) }); }
        close() { all.splice(all.indexOf(this), 1); }
    };
}

test('messages reach everyone, or only the window they are for', () => {
    const Ch = bus(), got = { a: [], b: [], c: [] };
    const a = link.open('a', (m) => got.a.push(m), Ch);
    link.open('b', (m) => got.b.push(m), Ch);
    link.open('c', (m) => got.c.push(m), Ch);
    a.send({ type: 'script', text: 'x' });
    a.send({ type: 'cmd', to: 'c', action: 'toggle' });
    assert.equal(got.a.length, 0, 'a window does not hear itself');
    assert.deepEqual(got.b.map((m) => m.type), ['script']);
    assert.deepEqual(got.c.map((m) => m.type), ['script', 'cmd']);
    assert.equal(got.c[0].v, link.V);
    assert.equal(got.c[0].from, 'a');
});

test('messages of another version or with no type are dropped', () => {
    const Ch = bus(), got = [];
    link.open('b', (m) => got.push(m), Ch);
    const raw = new Ch();
    raw.postMessage({ v: 99, type: 'pos' });
    raw.postMessage({ v: link.V });
    raw.postMessage(null);
    assert.equal(got.length, 0);
});

test('no BroadcastChannel: open() returns null and the page runs alone', () => {
    assert.equal(link.open('a', () => {}, null), null);
    assert.equal(link.open('a', () => {}, class { constructor() { throw new Error('file://'); } }), null);
});

const render = require('../prompter/render.js');
// a layout of paragraphs with these line counts, one-line gaps, lh px lines
function layout(lines, lh) {
    let top = 0;
    return { lh, paras: lines.map((n) => { const p = { top, lines: n }; top += (n + 1) * lh; return p; }) };
}

// Walk the lead from its first line to its last, 1 px at a time, and
// record where a follower is placed.
function walk(lead, fol) {
    const out = [];
    for (let y = render.topYOf(lead); y <= render.endYOf(lead) + 1e-9; y += 1)
        out.push(render.place(fol, render.locate(lead, y)));
    return out;
}

test('following by place in the paragraph: a portrait screen never leaps or stalls', () => {
    // the lead (wide) wraps each paragraph into 3 lines, a portrait
    // follower wraps the same paragraphs into 7
    const lead = layout([3, 3, 3, 3], 50), fol = layout([7, 7, 7, 7], 30);
    const ys = walk(lead, fol), steps = ys.slice(1).map((v, i) => v - ys[i]);
    assert.ok(steps.every((d) => d >= -1e-9), 'never backwards');
    // even pace: every block is (7+1)/(3+1) = 2 follower lines per lead line,
    // the last paragraph (7-1)/(3-1) = 3; 1 lead px = 1/50 line
    const blocks = steps.slice(0, Math.floor(3.5 * 50) * 3);
    for (const d of blocks) assert.ok(Math.abs(d - 2 * 30 / 50) < 1e-6, 'block pace ' + d);
    assert.ok(Math.max(...steps) <= 3 * 30 / 50 + 1e-9, 'largest step ' + Math.max(...steps));
    assert.ok(Math.min(...steps) >= 2 * 30 / 50 - 1e-9, 'no stall in the gaps');
});

test('every paragraph starts on the reading line at the same moment, and the script ends together', () => {
    const lead = layout([2, 5, 1, 4], 40), fol = layout([4, 9, 2, 6], 24);
    for (let i = 0; i < 4; i++) {
        const P = lead.paras[i], F = fol.paras[i];
        const first = render.place(fol, render.locate(lead, P.top + 0.5 * 40));
        assert.ok(Math.abs(first - (F.top + 0.5 * 24)) < 1e-9, 'first line of ' + i + ': ' + first);
    }
    const end = render.place(fol, render.locate(lead, render.endYOf(lead)));
    assert.ok(Math.abs(end - render.endYOf(fol)) < 1e-9, 'ends together: ' + end);
    // the same layout maps onto itself exactly
    const L = layout([3, 1, 6], 33);
    for (const y of [10, 50, 99, 200, 333])
        assert.ok(Math.abs(render.place(L, render.locate(L, y)) - y) < 1e-9, 'identity at ' + y);
});

test('the map is continuous everywhere, one-line paragraphs included', () => {
    for (const [a, b] of [[[1, 1, 1], [1, 4, 2]], [[4, 1, 3], [1, 1, 1]], [[2, 7, 1, 1], [7, 2, 3, 1]], [[3, 3], [3, 3]]]) {
        const lead = layout(a, 20), fol = layout(b, 30);
        const ys = walk(lead, fol);
        for (let i = 1; i < ys.length; i++) {
            const d = ys[i] - ys[i - 1];
            assert.ok(d >= -1e-9 && d < 30 * 0.25, a + ' → ' + b + ' at step ' + i + ': ' + d);
        }
    }
});

test('advance() walks across paragraph boundaries both ways', () => {
    const L = layout([3, 2, 4], 10);
    assert.deepEqual(render.advance(L, { para: 0, rel: 3.5, pl: 3, ppl: 0 }, 1), { para: 1, rel: 0.5, pl: 2, ppl: 3 });
    assert.deepEqual(render.advance(L, { para: 1, rel: 0.25, pl: 2, ppl: 3 }, -1), { para: 0, rel: 3.25, pl: 3, ppl: 0 });
    const end = render.advance(L, { para: 2, rel: 3, pl: 4 }, 50);
    assert.equal(end.para, 2, 'stays in the last paragraph (clamped later)');
});

// A fake renderer/motion/player trio, enough for station.
function rig() {
    const r = {
        _y: 100, _anchor: { offset: 0, frac: 0.5 }, countdown: null, ended: false,
        setY(y) { this._y = y; return true; }, y() { return this._y; },
        anchor() { return { ...this._anchor }; }, setAnchor(a) { this._anchor = { ...a }; this._y = a.offset; },
        yFor(a) { return a.offset; }, lineHeight() { return 10; }, scrollLines() { return 100; },
        locate(y) { return { para: 0, rel: (y == null ? this._y : y) / 10, pl: 1e9 }; },
        place(loc) { return loc.rel * 10; }, advance(loc, d) { return { ...loc, rel: loc.rel + d }; },
        topY() { return 0; }, endY() { return 1000; },
        setCountdown(n) { this.countdown = n; }, setEnded(v) { this.ended = v; },
    };
    const m = {
        pos: 0, velocity: 0, playing: false, direction: 1, elapsed: 0, progress: 0, speed: 0.6, ended: false,
        setPos(p) { this.pos = p; }, setBounds() {}, setEnded(v) { this.ended = v; }, setDirection(d) { this.direction = d; },
        setSpeed(v) { this.speed = v; }, setElapsed(v) { this.elapsed = v; },
    };
    const calls = [];
    const p = {
        running: () => m.playing, atEnd: () => false, atStop: () => false, countdownLeft: () => null, countingDown: () => false,
        halt() { calls.push('halt'); m.playing = false; }, play() { calls.push('play'); m.playing = true; },
        kick() { calls.push('kick'); }, layout(y) { calls.push('layout:' + y); }, posFromY: (y) => y / 10,
        toggle() { calls.push('toggle'); }, top() { calls.push('top'); }, nudge(n) { calls.push('nudge:' + n); },
        paragraph(d) { calls.push('para:' + d); }, reverse() { calls.push('reverse'); }, setSpeed(v) { calls.push('speed:' + v); },
        pause() { calls.push('pause'); },
    };
    const sent = [];
    const frames = [];
    let clock = 5000;
    const st = station.create({
        renderer: r, motion: m, player: p, link: { send: (x) => sent.push(x) },
        raf: (cb) => { frames.push(cb); return frames.length; }, wall: () => clock,
    });
    return { r, m, p, st, calls, sent, frames, setClock: (c) => { clock = c; } };
}

test('the lead broadcasts on a change, and at most every 80 ms while moving', () => {
    const { st, sent, setClock } = rig();
    st.changed();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'pos');
    setClock(5040); st.tick();
    assert.equal(sent.length, 1, 'too soon');
    setClock(5100); st.tick();
    assert.equal(sent.length, 2);
});

test('handing the lead over: the old lead halts, the new one carries on', () => {
    const a = rig();
    a.st.setLead(false);
    assert.ok(a.calls.includes('halt'));
    assert.equal(a.st.isLead(), false);
    a.st.changed();
    assert.equal(a.sent.length, 0, 'a follower never broadcasts');

    const b = rig();
    b.st.setLead(false);
    b.st.setLead(true, { anchor: { offset: 420, frac: 0.5 }, playing: true, dir: -1, speed: 1.2, elapsed: 33 });
    assert.equal(b.r.anchor().offset, 420);
    assert.equal(b.m.direction, -1);
    assert.equal(b.m.speed, 1.2);
    assert.equal(b.m.elapsed, 33);
    assert.ok(b.calls.includes('play'));
    assert.equal(b.sent.at(-1).type, 'pos', 'announces itself at once');
});

test('a follower snaps on a jump and eases a small gap away', () => {
    const { st, r, frames, setClock } = rig();
    st.setLead(false);
    r._y = 100;
    st.onPos({ anchor: { offset: 900, frac: 0 }, vel: 0, sl: 100, t: 5000, countdown: 3, ended: false });
    assert.equal(r.countdown, 3);
    frames.shift()(16);
    assert.equal(r.y(), 900, 'more than 3 lines away: snap');

    st.onPos({ anchor: { offset: 905, frac: 0 }, vel: 0, sl: 100, t: 5000 });
    frames.shift()(16);              // first frame: no time has passed
    assert.equal(r.y(), 900);
    let t = 16;
    while (frames.length && t < 2000) { t += 16; frames.shift()(t); }
    assert.ok(Math.abs(r.y() - 905) < 0.31, 'eased to the lead: ' + r.y());
    assert.equal(frames.length, 0, 'and then stops asking for frames');
    setClock(6000);
});

test('status comes from the lead\'s last pos while following', () => {
    const { st } = rig();
    st.setLead(false);
    st.onPos({ anchor: { offset: 0, frac: 0 }, vel: 0.5, sl: 100, t: 5000, running: true, playing: true, dir: -1, ended: false, elapsed: 12, progress: 0.25 });
    const s = st.status();
    assert.equal(s.lead, false);
    assert.equal(s.running, true);
    assert.equal(s.dir, -1);
    assert.equal(s.elapsed, 12);
    assert.equal(s.progress, 0.25);
});

test('perform() maps every transport command', () => {
    const { p, calls, m } = rig();
    for (const [a, arg] of [['toggle'], ['top'], ['nudge', -1], ['paragraph', 1], ['reverse'], ['speed', 1.5]]) {
        assert.equal(station.perform(p, a, arg), true, a);
    }
    m.playing = false; station.perform(p, 'play');
    m.playing = true; station.perform(p, 'pause');
    assert.deepEqual(calls, ['toggle', 'top', 'nudge:-1', 'para:1', 'reverse', 'speed:1.5', 'play', 'pause']);
    assert.equal(station.perform(p, 'nonsense'), false);
});

test('a window opens over the chosen screen\'s free area', () => {
    const e = { left: 1920, top: 0, w: 2560, h: 1400 };
    assert.equal(screens.features(e, false), 'popup,left=1920,top=0,width=2560,height=1400');
    assert.equal(screens.features(e, true), 'popup,left=1920,top=0,width=2560,height=1400,fullscreen');
    assert.equal(screens.features(null, true), 'popup,width=960,height=600');
});

test('screens: no Window Management API means unsupported, not an error', () => {
    const win = { screen: {}, navigator: {}, open: () => null };
    const s = screens.create(win);
    assert.equal(s.state().api, false);
    assert.equal(s.state().permission, 'unsupported');
    assert.equal(s.state().extended, null);
    return s.detect().then((st) => assert.equal(st.list.length, 0));
});

test('screens: listed with names, the current one marked, once allowed', async () => {
    const A = { label: 'Built-in', left: 0, top: 0, width: 1920, height: 1080, availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1050, isPrimary: true, isInternal: true };
    const B = { label: 'DELL U2720Q', left: 1920, top: 0, width: 3840, height: 2160, availLeft: 1920, availTop: 0, availWidth: 3840, availHeight: 2160, isPrimary: false };
    const details = { screens: [A, B], currentScreen: A, addEventListener() {} };
    const win = { screen: { isExtended: true, addEventListener() {} }, navigator: {}, getScreenDetails: () => Promise.resolve(details), open: () => null };
    let changes = 0;
    const s = screens.create(win, () => changes++);
    assert.equal(s.state().extended, true, 'known before any prompt');
    await s.detect();
    const list = s.state().list;
    assert.equal(list.length, 2);
    assert.equal(list[0].current, true);
    assert.equal(list[1].label, 'DELL U2720Q');
    assert.equal(list[1].left, 1920);
    assert.equal(s.state().permission, 'granted');
    assert.ok(changes >= 1);
});
