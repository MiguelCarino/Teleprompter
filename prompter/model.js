/* prompter/model.js — script text → blocks. Pure: no DOM, no globals read.

   A script is plain text. One or more blank lines separate paragraphs
   (blocks); a single newline inside a paragraph is a line break and stays
   in the text. A [bracketed] run on one line is a cue: it is shown in the
   cue colour and is not counted as spoken words.

   Every position is a character offset into the original text, so the
   renderer, the editor and (later) the link protocol all speak the same
   unit. Nothing here copies the text: blocks and runs are offset ranges.

     parse(text) → { text, blocks: [{ start, end, runs: [{ start, end, cue }] }], words }

   Classic script, so the page works over file:// as well as http. In a
   browser it attaches to window.TP.model; in node it is module.exports. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.TP = root.TP || {}; root.TP.model = api; }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    var CUE = /\[[^\]\n]*\]/g;          // one line at most, like the old page
    var BLANK = /\n[ \t\r\f\v]*\n[\s]*/g; // a blank line (or several) between paragraphs
    var CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;

    function isSpace(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '\u00a0'; }

    // [start, end) trimmed of whitespace at both ends; null when nothing is left.
    function trimRange(text, start, end) {
        while (start < end && isSpace(text[start])) start++;
        while (end > start && isSpace(text[end - 1])) end--;
        return start < end ? [start, end] : null;
    }

    // The cue search runs on the block's own text, so a block without a cue
    // costs its length, not a scan to the next '[' further down the script
    // (that made parse() quadratic on long scripts with few cues).
    function runsOf(text, start, end) {
        var runs = [], last = start, m, sub = text.slice(start, end);
        CUE.lastIndex = 0;
        while ((m = CUE.exec(sub))) {
            var a = start + m.index, b = a + m[0].length;
            if (a > last) runs.push({ start: last, end: a, cue: false });
            runs.push({ start: a, end: b, cue: true });
            last = b;
        }
        if (last < end) runs.push({ start: last, end: end, cue: false });
        return runs;
    }

    // Spoken words, roughly: whitespace-separated tokens, cues left out.
    // Scripts without spaces (Japanese, Chinese) count about two characters
    // per word, which keeps a WPM readout in a sensible range.
    function countWords(s) {
        s = String(s).replace(CUE, ' ');
        var n = 0, toks = s.split(/\s+/);
        for (var i = 0; i < toks.length; i++) {
            var tok = toks[i];
            if (!tok) continue;
            var cjk = (tok.match(CJK) || []).length;
            var rest = /[\p{L}\p{N}]/u.test(tok.replace(CJK, ''));
            n += (cjk ? Math.max(1, Math.round(cjk / 2)) : 0) + (rest ? 1 : 0);
        }
        return n;
    }

    function parse(text) {
        text = text == null ? '' : String(text);
        var blocks = [], words = 0, pos = 0, m;
        BLANK.lastIndex = 0;
        function push(a, b) {
            var r = trimRange(text, a, b);
            if (!r) return;
            blocks.push({ start: r[0], end: r[1], runs: runsOf(text, r[0], r[1]) });
            words += countWords(text.slice(r[0], r[1]));
        }
        while ((m = BLANK.exec(text))) {
            push(pos, m.index);
            pos = m.index + m[0].length;
        }
        push(pos, text.length);
        return { text: text, blocks: blocks, words: words };
    }

    // Index of the block holding `offset`; an offset between two blocks
    // belongs to the next one, past the end to the last one. -1 when empty.
    function blockIndexAt(blocks, offset) {
        if (!blocks.length) return -1;
        var lo = 0, hi = blocks.length - 1, ans = 0;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (blocks[mid].start <= offset) { ans = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (offset >= blocks[ans].end && ans < blocks.length - 1) ans++;
        return ans;
    }

    // Carry an offset in oldText to newText through one edit, found as the
    // common prefix and suffix of the two. Text changed before the offset
    // shifts it, text after it does not; an offset inside the changed span
    // lands at the start of the change. A pure insertion exactly at the
    // offset counts as before it: the offset keeps following the character
    // it pointed at, because typing at the end of the line above and at the
    // start of the anchor's line are the same caret position. The one
    // exception is offset 0, the top of the script: new text there becomes
    // the new start. (An early piece of P3, which builds the in-line rewrite
    // and the "you are here" bar on top of this.)
    function mapOffset(oldText, newText, offset) {
        if (oldText === newText) return offset;
        var a = oldText.length, b = newText.length, max = Math.min(a, b), p = 0;
        while (p < max && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
        var s = 0;
        while (s < max - p && oldText.charCodeAt(a - 1 - s) === newText.charCodeAt(b - 1 - s)) s++;
        if (offset < p) return offset;
        if (offset === p && (offset === 0 || a - s > p)) return offset;   // at the top, or a replacement starting here
        if (offset >= a - s) return offset + (b - a);
        return p;
    }

    return { parse: parse, countWords: countWords, blockIndexAt: blockIndexAt, mapOffset: mapOffset };
});
