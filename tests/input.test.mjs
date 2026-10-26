// node --test tests/ — input.js: the fixed key map, and which focused
// controls keep a key for themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const input = require('../prompter/input.js');

test('the fixed key map', () => {
    const a = (key, mods) => input.actionFor(Object.assign({ key }, mods));
    assert.equal(a(' '), 'toggle');
    assert.equal(a('MediaPlayPause'), 'toggle');
    assert.equal(a('ArrowUp'), 'faster');
    assert.equal(a('ArrowLeft'), 'back');
    assert.equal(a('PageDown'), 'nextPara');
    assert.equal(a('Home'), 'top');
    assert.equal(a('R'), 'reverse');
    assert.equal(a('f'), 'fullscreen');
    assert.equal(a('Escape'), 'escape');
    assert.equal(a('x'), null);
    assert.equal(a('toString'), null);
    assert.equal(a(' ', { ctrlKey: true }), null);
    assert.equal(a(' ', { isComposing: true }), null);
});

// a minimal stand-in for an element: closest() over a tag/type selector list
function fake(tag, type) {
    const el = {
        tagName: tag.toUpperCase(),
        getAttribute: (n) => (n === 'type' ? type || null : null),
        closest(sel) {
            for (const part of sel.split(',').map((x) => x.trim())) {
                const m = part.match(/^([a-z]+)/);
                if (!m || m[1] !== tag) continue;
                if (/\[href\]/.test(part) || /contenteditable/.test(part)) continue;
                return el;
            }
            return null;
        },
    };
    return el;
}

test('text entry keeps every key; a checkbox keeps only Space', () => {
    assert.equal(input.ownsKey(fake('textarea'), ' '), true);
    assert.equal(input.ownsKey(fake('input', 'text'), 'ArrowLeft'), true);
    assert.equal(input.ownsKey(fake('input', 'checkbox'), ' '), true);
    assert.equal(input.ownsKey(fake('input', 'checkbox'), 'ArrowRight'), false);
    assert.equal(input.ownsKey(fake('input', 'checkbox'), 'PageDown'), false);
});

test('a slider keeps its arrows but not Space; a button keeps Space and Enter', () => {
    assert.equal(input.ownsKey(fake('input', 'range'), 'ArrowUp'), true);
    assert.equal(input.ownsKey(fake('input', 'range'), ' '), false);
    assert.equal(input.ownsKey(fake('input', 'range'), 'r'), false);
    assert.equal(input.ownsKey(fake('button'), ' '), true);
    assert.equal(input.ownsKey(fake('button'), 'ArrowRight'), false);
    assert.equal(input.ownsKey(fake('div'), ' '), false);
    assert.equal(input.ownsKey(null, ' '), false);
});
