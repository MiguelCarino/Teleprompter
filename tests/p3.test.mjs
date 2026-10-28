// node --test tests/ — P3: headings and stops in the model, the edit
// carried through to the renderer, stops in the player, the 1–9 keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const model = require('../prompter/model.js');
const render = require('../prompter/render.js');
const motionLib = require('../prompter/motion.js');
const playerLib = require('../prompter/player.js');
const input = require('../prompter/input.js');

const slice = (m, r) => m.text.slice(r.start, r.end);

// ---- markup ----
test('a # line is a heading and a --- line is a stop, even inside a paragraph', () => {
    const m = model.parse('Intro line\n# Opening\nHello there.\n---\nMore text');
    assert.deepEqual(m.blocks.map((b) => [b.kind, slice(m, b)]),
        [['text', 'Intro line'], ['heading', '# Opening'], ['text', 'Hello there.'], ['stop', '---'], ['text', 'More text']]);
    const h = m.blocks[1];
    assert.equal(h.level, 1);
    assert.deepEqual(h.runs.map((r) => slice(m, r)), ['Opening'], 'the # marker is not shown');
    assert.deepEqual(m.blocks[3].runs, []);
});

test('#hashtag, a lone #, and -- are plain text; ## and ---- work', () => {
    const m = model.parse('#hashtag here\n\n#\n\n--\n\n## Two\n\n-----');
    assert.deepEqual(m.blocks.map((b) => b.kind), ['text', 'text', 'text', 'heading', 'stop']);
    assert.equal(m.blocks[3].level, 2);
});

test('headings and stops are not spoken words', () => {
    assert.equal(model.parse('# A long heading here\n\nOne two three.\n\n---').words, 3);
});

test('marks lists headings and stops in order, with their offsets', () => {
    const t = 'Hi\n\n# Part [one]\n\nText\n---\n## Two';
    const mk = model.marks(model.parse(t));
    assert.deepEqual(mk.map((x) => [x.kind, x.label, t.slice(x.offset, x.offset + 2)]),
        [['heading', 'Part [one]', '# '], ['stop', '', '--'], ['heading', 'Two', '##']]);
    assert.equal(mk[1].block, 3);
});

// ---- edits ----
test('diff finds the one changed span', () => {
    assert.deepEqual(model.diff('Hello world', 'Hello brave world'), { p: 6, oldEnd: 6, newEnd: 12 });
    assert.deepEqual(model.diff('abc', 'abc'), { p: 3, oldEnd: 3, newEnd: 3 });
    assert.deepEqual(model.diff('one two three', 'one 2 three'), { p: 4, oldEnd: 7, newEnd: 5 });
});

test('editInBlock: inside one paragraph yes; across a boundary or a new paragraph no', () => {
    const a = model.parse('First para here.\n\nSecond one is longer.\n\nThird.');
    const inside = model.parse('First para here.\n\nSecond one is much longer.\n\nThird.');
    assert.equal(model.editInBlock(a, inside, model.diff(a.text, inside.text)), 1);
    const split = model.parse('First para here.\n\nSecond one\n\nis longer.\n\nThird.');
    assert.equal(model.editInBlock(a, split, model.diff(a.text, split.text)), -1);
    const joined = model.parse('First para here. Second one is longer.\n\nThird.');
    assert.equal(model.editInBlock(a, joined, model.diff(a.text, joined.text)), -1);
    // a line turned into a heading changes the paragraphs too
    const head = model.parse('First para here.\n\n# Second one is longer.\n\nThird.');
    assert.equal(model.editInBlock(a, head, model.diff(a.text, head.text)), -1);
});

test('carry maps the anchor and describes the edit', () => {
    const a = model.parse('One.\n\nTwo three four.'), b = model.parse('One more.\n\nTwo three four.');
    const c = model.carry(a, b, { offset: 6, frac: 0.4 });
    assert.deepEqual(c.anchor, { offset: 11, frac: 0.4 });
    assert.equal(c.edit.block, 0);
    assert.deepEqual(c.edit.d, { p: 3, oldEnd: 3, newEnd: 8 });
});

test('touchesLine: on the line or at either end of it', () => {
    assert.ok(render.touchesLine({ p: 12, oldEnd: 12 }, 10, 20));
    assert.ok(render.touchesLine({ p: 10, oldEnd: 10 }, 10, 20), 'typing at its start');
    assert.ok(render.touchesLine({ p: 20, oldEnd: 20 }, 10, 20), 'typing at its end');
    assert.ok(render.touchesLine({ p: 5, oldEnd: 15 }, 10, 20), 'a span over its start');
    assert.ok(!render.touchesLine({ p: 2, oldEnd: 8 }, 10, 20), 'above it');
    assert.ok(!render.touchesLine({ p: 25, oldEnd: 30 }, 10, 20), 'below it');
});

test('keepLine keeps the line and the point in it, or the last line', () => {
    assert.equal(render.keepLine(2.4, 5), 2.4);
    assert.equal(render.keepLine(2.4, 2), 1.4);
    assert.equal(render.keepLine(0.5, 1), 0.5);
});

// ---- stops in the player ----
// A fake renderer: line units = px / 10, stops at the given line numbers.
function rig(stopLines, opts = {}) {
    const lh = 10;
    let y = lh / 2, frames = [], t = 0;
    const renderer = {
        topY: () => lh / 2, endY: () => lh / 2 + (opts.lines || 40) * lh, lineHeight: () => lh,
        y: () => y, setY(v) { y = v; return true; },
        paraYs: () => [5], stopYs: () => stopLines.map((n) => lh / 2 + n * lh),
        yFor: (a) => lh / 2 + a.offset * lh,   // offset = line number here
        anchor: () => ({ offset: 0, frac: 0.5 }), setEnded() {}, setCountdown() {},
    };
    const motion = motionLib.create({ speed: opts.speed || 2, ramp: opts.ramp == null ? 0.5 : opts.ramp });
    const player = playerLib.create({ motion, renderer, raf: (cb) => { frames.push(cb); return frames.length; }, now: () => t, wall: () => t });
    player.layout(y);
    function run(sec) {
        const end = t + sec * 1000;
        while (t < end && frames.length) { t += 1000 / 60; const f = frames; frames = []; f.forEach((cb) => cb(t)); }
        if (t < end) t = end;
    }
    return { motion, player, run };
}

test('playback eases out and comes to rest exactly on a stop', () => {
    const r = rig([6]);
    r.player.play();
    let maxPos = 0;
    for (let i = 0; i < 60; i++) { r.run(0.1); maxPos = Math.max(maxPos, r.motion.pos); }
    assert.equal(r.motion.pos, 6);
    assert.ok(maxPos <= 6 + 1e-9, 'never past the stop: ' + maxPos);
    assert.equal(r.player.running(), false);
    assert.equal(r.player.atStop(), true);
});

test('the speed falls smoothly into a stop (no jump in velocity)', () => {
    const r = rig([5], { speed: 2 });
    r.player.play();
    const v = [];
    for (let i = 0; i < 200 && (r.player.running() || r.motion.isActive()); i++) { r.run(1 / 60); v.push(r.motion.velocity); }
    for (let i = 1; i < v.length; i++) assert.ok(Math.abs(v[i] - v[i - 1]) < 0.15, 'step ' + i + ': ' + v[i - 1] + ' → ' + v[i]);
    assert.equal(r.motion.pos, 5);
});

test('play again carries on past the stop, to the next one', () => {
    const r = rig([4, 9]);
    r.player.play(); r.run(6);
    assert.equal(r.motion.pos, 4);
    r.player.play(); r.run(0.5);
    assert.equal(r.player.atStop(), false);
    r.run(8);
    assert.equal(r.motion.pos, 9);
    assert.equal(r.player.atStop(), true);
});

test('with no ramp a stop still holds exactly', () => {
    const r = rig([3], { ramp: 0, speed: 5 });
    r.player.play(); r.run(3);
    assert.equal(r.motion.pos, 3);
});

test('reverse and seeks pass stops; a jump lands where it was sent', () => {
    const r = rig([3]);
    r.player.jumpTo(10); r.run(1);
    assert.ok(Math.abs(r.motion.pos - 10) < 1e-9, String(r.motion.pos));
    r.player.reverse(); r.player.play(); r.run(8);
    assert.ok(r.motion.pos < 3, 'reverse went past the stop: ' + r.motion.pos);
});

test('keys 1–9 are jumps; 0 is not', () => {
    assert.equal(input.actionFor({ key: '1' }), 'jump1');
    assert.equal(input.actionFor({ key: '9' }), 'jump9');
    assert.equal(input.actionFor({ key: '0' }), null);
    assert.equal(input.actionFor({ key: '3', ctrlKey: true }), null);
});
