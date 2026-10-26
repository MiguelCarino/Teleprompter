// node --test tests/ — every string the page shows is in all four locales,
// no dictionary carries dead keys, and the sample script key matches app.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const LOCALES = ['es', 'pt-BR', 'ja', 'ru'];
// read by carino-navbar.js through window.t
const NAVBAR = ['More', 'Late shift.', 'Good morning.', 'Good afternoon.', 'Good evening.'];

function loadI18n() {
    const ctx = { window: { addEventListener() {} }, document: { addEventListener() {} } };
    vm.createContext(ctx);
    vm.runInContext(read('i18n.js') + '\n;globalThis.__out = { I18N, SAMPLE_EN };', ctx);
    return ctx.__out;
}
const { I18N, SAMPLE_EN } = loadI18n();

function appSample() {
    const src = read('prompter/app.js');
    const m = src.match(/var SAMPLE = ([\s\S]*?);\n/);
    assert.ok(m, 'SAMPLE in app.js');
    return Function('return ' + m[1])();
}

function usedKeys() {
    const html = read('index.html');
    const keys = new Set(NAVBAR);
    // <tag … data-i18n …>text</tag>
    for (const m of html.matchAll(/<(\w+)[^>]*\sdata-i18n(?=[\s>=])[^>]*>([^<]*)</g)) keys.add(m[2].trim().replace(/\s+/g, ' '));
    for (const m of html.matchAll(/data-i18n-(?:aria-label|placeholder|title)="([^"]+)"/g)) keys.add(m[1]);
    const app = read('prompter/app.js');
    for (const m of app.matchAll(/\btt\('((?:[^'\\]|\\.)*)'\)/g)) keys.add(m[1]);
    for (const m of app.matchAll(/setLabel\(\$\('\w+'\),\s*([^\n]*)\);/g)) for (const s of m[1].matchAll(/'([^']+)'/g)) keys.add(s[1]);
    // the state names, looked up through tt({ … }[state])
    const states = app.match(/tt\(\{([^}]*)\}\[st\]\)/);
    assert.ok(states, 'state label map in app.js');
    for (const s of states[1].matchAll(/'([^']+)'/g)) keys.add(s[1]);
    // dynamic play label
    for (const s of app.match(/var key = ([^;]+);/)[1].matchAll(/'([^']+)'/g)) keys.add(s[1]);
    keys.add(SAMPLE_EN);
    keys.delete('');
    return keys;
}

test('the sample script key in i18n.js is the sample app.js shows', () => {
    assert.equal(appSample(), SAMPLE_EN);
});

test('every used string is translated in every locale', () => {
    const keys = usedKeys();
    for (const loc of LOCALES) {
        const missing = [...keys].filter((k) => !(k in I18N[loc]));
        assert.deepEqual(missing, [], loc + ' is missing keys');
    }
});

test('no locale has keys the page no longer uses, and all locales match', () => {
    const keys = usedKeys();
    const ref = Object.keys(I18N.es).sort();
    for (const loc of LOCALES) {
        assert.deepEqual(Object.keys(I18N[loc]).sort(), ref, loc + ' has the same keys as es');
        const dead = Object.keys(I18N[loc]).filter((k) => !keys.has(k));
        assert.deepEqual(dead, [], loc + ' has unused keys');
    }
});

test('translated samples keep their cues and paragraphs', () => {
    const paras = SAMPLE_EN.split('\n\n').length;
    for (const loc of LOCALES) {
        const s = I18N[loc][SAMPLE_EN];
        assert.equal(s.split('\n\n').length, paras, loc);
        assert.ok((s.match(/\[[^\]]+\]/g) || []).length >= 4, loc + ' has cues');
    }
});
