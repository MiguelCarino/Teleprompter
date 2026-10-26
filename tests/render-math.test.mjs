// node --test tests/ — render.js anchor ⇄ pixel math on a synthetic layout.
// The DOM half of render.js only measures; this checks the mapping itself:
// a round trip in one layout, and keeping the same words on the reading
// line when the layout changes (text size, margins, window width).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const model = require('../prompter/model.js');
const render = require('../prompter/render.js');

// A monospace stand-in for the browser: `cols` characters per line, every
// line `lh` px, paragraphs one empty line apart (as render.js lays out).
function fakeLayout(m, cols, lh) {
    let top = 0;
    const paras = m.blocks.map((b) => {
        const lines = Math.max(1, Math.ceil((b.end - b.start) / cols));
        const p = { top, lines, start: b.start, end: b.end };
        top += (lines + 1) * lh;
        return p;
    });
    const L = { lh, paras };
    return {
        L,
        lineOf: (i, k) => Math.floor((k - paras[i].start) / cols),
        lineStart: (i, li) => paras[i].start + li * cols,
    };
}

const TEXT = [
    'The first paragraph is short.',
    'The second paragraph runs on for a while so that it wraps over several lines at any of the widths in this test.',
    'Third.',
    'A fourth paragraph with [a cue] inside it and enough words to wrap a couple of times as well.',
    'The end.',
].join('\n\n');
const M = model.parse(TEXT);

test('anchor → y → anchor round-trips everywhere, gaps and edges included', () => {
    const A = fakeLayout(M, 24, 40);
    const last = A.L.paras.at(-1);
    const bottom = last.top + last.lines * 40 + 80;
    for (let y = -60; y <= bottom; y += 7.3) {
        const a = render.anchorFromY(A.L, y, A.lineStart);
        const back = render.yFromAnchor(A.L, a, A.lineOf);
        assert.ok(Math.abs(back - y) < 1e-9, `y ${y} → ${JSON.stringify(a)} → ${back}`);
    }
});

test('inside a paragraph the anchor is the first character of the line', () => {
    const A = fakeLayout(M, 24, 40);
    const p = A.L.paras[1];
    const a = render.anchorFromY(A.L, p.top + 2.25 * 40, A.lineStart);
    assert.equal(a.offset, p.start + 2 * 24);
    assert.ok(Math.abs(a.frac - 0.25) < 1e-9);
});

test('a gap anchor belongs to the next paragraph, with a negative frac', () => {
    const A = fakeLayout(M, 24, 40);
    const p0 = A.L.paras[0], p1 = A.L.paras[1];
    const a = render.anchorFromY(A.L, p0.top + p0.lines * 40 + 10, A.lineStart);
    assert.equal(a.offset, p1.start);
    assert.ok(a.frac < 0 && a.frac >= -1);
});

test('a relayout keeps the same words on the reading line', () => {
    const A = fakeLayout(M, 30, 40);     // small text, wide column
    const B = fakeLayout(M, 13, 72);     // big text: fewer characters per line
    for (const pi of [0, 1, 3]) {
        const p = A.L.paras[pi];
        for (let li = 0; li < p.lines; li++) {
            const y = p.top + (li + 0.5) * 40;
            const a = render.anchorFromY(A.L, y, A.lineStart);
            const yB = render.yFromAnchor(B.L, a, B.lineOf);
            const aB = render.anchorFromY(B.L, yB, B.lineStart);
            // B's reading line holds the character that started A's line
            const bp = B.L.paras.findIndex((q) => q.start <= a.offset && a.offset < q.end);
            assert.equal(bp, pi);
            const bLine = B.lineOf(bp, a.offset);
            assert.equal(aB.offset, B.lineStart(bp, bLine));
            assert.ok(aB.offset <= a.offset && a.offset < aB.offset + 13);
            assert.ok(Math.abs(aB.frac - 0.5) < 1e-9, 'same place through the line');
        }
    }
});

test('an anchor mapped through an edit ahead of it keeps its line', () => {
    const A = fakeLayout(M, 24, 40);
    const p = A.L.paras[3];
    const a = render.anchorFromY(A.L, p.top + 1.5 * 40, A.lineStart);
    const edited = TEXT.replace('The end.', 'The very end, rewritten.');
    const M2 = model.parse(edited);
    const a2 = { offset: model.mapOffset(TEXT, edited, a.offset), frac: a.frac };
    assert.equal(a2.offset, a.offset);
    const A2 = fakeLayout(M2, 24, 40);
    assert.equal(render.yFromAnchor(A2.L, a2, A2.lineOf), render.yFromAnchor(A.L, a, A.lineOf));
});

test('an empty script maps without throwing', () => {
    const E = { lh: 50, paras: [] };
    const a = render.anchorFromY(E, 25, () => 0);
    assert.deepEqual(a, { offset: 0, frac: 0.5 });
    assert.equal(render.yFromAnchor(E, a, () => 0), 25);
});

test('scroll distance counts the gaps between paragraphs', () => {
    const A = fakeLayout(M, 24, 40);
    const lines = A.L.paras.reduce((n, p) => n + p.lines, 0);
    // first line centred → last line centred: every text line and every gap, minus one
    assert.equal(render.scrollLines(A.L), lines + A.L.paras.length - 2);
    assert.equal(render.endYOf(A.L) - render.topYOf(A.L), render.scrollLines(A.L) * 40);
    assert.equal(render.scrollLines({ lh: 40, paras: [] }), 0);
});
