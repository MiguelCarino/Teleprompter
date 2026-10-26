// node --test tests/ — model.js (script text → blocks) and offset mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const model = require('../prompter/model.js');

const slice = (m, r) => m.text.slice(r.start, r.end);

test('blank lines split paragraphs; single newlines stay inside one', () => {
    const m = model.parse('One line\nsame paragraph.\n\nSecond.\n \n\n\nThird.');
    assert.equal(m.blocks.length, 3);
    assert.equal(slice(m, m.blocks[0]), 'One line\nsame paragraph.');
    assert.equal(slice(m, m.blocks[1]), 'Second.');
    assert.equal(slice(m, m.blocks[2]), 'Third.');
});

test('blocks are trimmed offset ranges into the original text', () => {
    const text = '\n\n   Hello there.  \n\n  Next  ';
    const m = model.parse(text);
    assert.equal(m.text, text);
    assert.deepEqual(m.blocks.map(b => slice(m, b)), ['Hello there.', 'Next']);
    assert.equal(m.blocks[0].start, text.indexOf('Hello'));
});

test('CRLF scripts parse like LF', () => {
    const m = model.parse('A\r\n\r\nB');
    assert.deepEqual(m.blocks.map(b => slice(m, b)), ['A', 'B']);
});

test('[cue] runs are marked and cover the paragraph exactly', () => {
    const m = model.parse('Say [pause] this [smile]');
    const b = m.blocks[0];
    assert.deepEqual(b.runs.map(r => [slice(m, r), r.cue]),
        [['Say ', false], ['[pause]', true], [' this ', false], ['[smile]', true]]);
    assert.equal(b.runs[0].start, b.start);
    assert.equal(b.runs.at(-1).end, b.end);
});

test('a bracket never spans lines and an unclosed one is plain text', () => {
    const m = model.parse('open [not\nclosed] and [ok]');
    assert.deepEqual(m.blocks[0].runs.filter(r => r.cue).map(r => slice(m, r)), ['[ok]']);
    assert.equal(model.parse('[unclosed').blocks[0].runs[0].cue, false);
});

test('markup-looking text is just text', () => {
    const m = model.parse('<img src=x onerror=alert(1)>');
    assert.equal(slice(m, m.blocks[0]), '<img src=x onerror=alert(1)>');
});

test('empty and whitespace-only scripts have no blocks', () => {
    assert.equal(model.parse('').blocks.length, 0);
    assert.equal(model.parse(' \n\n \t').blocks.length, 0);
    assert.equal(model.parse(null).blocks.length, 0);
});

test('word count leaves cues out and copes with CJK', () => {
    assert.equal(model.countWords('Hello [pause] big world'), 3);
    assert.equal(model.countWords('— , .'), 0);
    assert.equal(model.countWords('これはテストです'), 4);
    assert.equal(model.parse('one two\n\nthree [x]').words, 3);
});

test('blockIndexAt: inside, between and past blocks', () => {
    const m = model.parse('Aaa\n\nBbb\n\nCcc');
    const [a, b, c] = m.blocks;
    assert.equal(model.blockIndexAt(m.blocks, a.start + 1), 0);
    assert.equal(model.blockIndexAt(m.blocks, a.end + 1), 1);   // in the gap → next
    assert.equal(model.blockIndexAt(m.blocks, c.end + 10), 2);
    assert.equal(model.blockIndexAt([], 3), -1);
    assert.ok(b);
});

test('mapOffset: edits before the offset shift it, edits after do not', () => {
    const old = 'Alpha beta gamma delta';
    const at = old.indexOf('gamma');
    assert.equal(model.mapOffset(old, 'Alpha BETA! gamma delta', at), at + 1);   // before
    assert.equal(model.mapOffset(old, 'Alpha beta gamma DELTA!!', at), at);      // after
    assert.equal(model.mapOffset(old, 'beta gamma delta', at), at - 6);           // deletion before
    assert.equal(model.mapOffset(old, old, at), at);
});

test('mapOffset: an insertion exactly at the offset follows the text it pointed at', () => {
    // the anchor is the first character of a visual line; typing at the end
    // of the line above is the same caret position, and must not pull the
    // reading line back onto the new text
    const old = 'alpha beta gamma delta epsilon';
    const at = old.indexOf('delta');
    assert.equal(model.mapOffset(old, old.slice(0, at) + 'ok ' + old.slice(at), at), at + 3);
    // a new paragraph typed at the anchor appears above the reading line
    const o2 = 'One.\n\nTwo.';
    const at2 = o2.indexOf('Two');
    const n2 = 'One.\n\nNew.\n\nTwo.';
    assert.equal(n2.slice(model.mapOffset(o2, n2, at2)), 'Two.');
});

test('mapOffset: at the top of the script, new text becomes the new start', () => {
    assert.equal(model.mapOffset('Body.', 'Title.\n\nBody.', 0), 0);
    assert.equal(model.mapOffset('', 'A whole pasted script.', 0), 0);
});

test('mapOffset: a replacement starting at the offset stays at the change start', () => {
    const old = 'keep THIS keep';
    const at = old.indexOf('THIS');
    assert.equal(model.mapOffset(old, 'keep that keep', at), at);
});

test('mapOffset: an offset inside a replaced span lands at the change start', () => {
    const old = 'keep REPLACED keep';
    const at = old.indexOf('PLA');
    assert.equal(model.mapOffset(old, 'keep x keep', at), 5);
});

test('parse is linear: a long script with few cues parses fast', () => {
    // one paragraph shape, no cue until the very end: a cue search that ran
    // past each block to the next '[' made this quadratic (about 1 s here)
    const para = 'The quick brown fox jumps over the lazy dog and keeps on running. ';
    const long = Array.from({ length: 6000 }, () => para.repeat(1)).join('\n\n') + '\n\nend [cue]';
    assert.ok(long.length > 400000);
    const t0 = performance.now();
    const m = model.parse(long);
    const ms = performance.now() - t0;
    assert.equal(m.blocks.length, 6001);
    assert.deepEqual(m.blocks.at(-1).runs.map((r) => r.cue), [false, true]);
    assert.ok(ms < 300, 'parse took ' + ms.toFixed(1) + ' ms');
});

test('cue runs are found inside their own block only', () => {
    const m = model.parse('no cue here\n\n[a] b [c]');
    assert.deepEqual(m.blocks[0].runs.map((r) => r.cue), [false]);
    assert.deepEqual(m.blocks[1].runs.map((r) => [slice(m, r), r.cue]), [['[a]', true], [' b ', false], ['[c]', true]]);
});
