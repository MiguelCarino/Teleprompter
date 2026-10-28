/* prompter/here.js — the "you are here" bar in the script editor (P3, §5.3).

   A textarea cannot colour part of its text, so the bar is drawn on a
   backdrop behind it: a div with the same box, font and wrapping, holding
   the same text in transparent ink, with the paragraph being read and the
   line on the reading line marked. The textarea itself is transparent and
   stays a plain textarea (the editor is the source of truth).

     var here = TP.here.create(textarea, backdrop, { mapOffset });
     here.set({ para: [a, b], line: [c, d] }, text);   // renderer.reading(), or null
     here.refresh();                             // the text or the box changed

   While the editor is not focused (and was not scrolled by hand in the
   last few seconds) it scrolls itself to keep the bar in view; while the
   operator types, it never moves. Classic script: window.TP.here. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.TP = root.TP || {}; root.TP.here = api; }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    var COPY = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'textIndent'];
    var HAND = 3000;   // ms: a hand scroll keeps the editor where it was put

    function create(ta, back, o) {
        o = o || {};
        var doc = ta.ownerDocument, range = null, text = null, drawn = '', handAt = -1e9, lineEl = null;

        function style() {
            var cs = doc.defaultView.getComputedStyle(ta), bs = back.style;
            COPY.forEach(function (k) { bs[k] = cs[k]; });
            bs.borderStyle = 'solid'; bs.borderColor = 'transparent';
            // the textarea's scrollbar takes width from its text
            var sb = ta.offsetWidth - ta.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
            if (sb > 0) bs.paddingRight = (parseFloat(cs.paddingRight) + sb) + 'px';
        }
        function piece(s, cls) {
            if (!cls) return doc.createTextNode(s);
            var m = doc.createElement('mark');
            m.className = cls;
            m.textContent = s;
            return m;
        }
        function draw() {
            var t = ta.value;
            // the editor changed since the range was measured: carry it along
            if (range && text != null && t !== text && o.mapOffset) {
                var f = function (k) { return o.mapOffset(text, t, k); };
                range = { para: [f(range.para[0]), f(range.para[1])], line: [f(range.line[0]), f(range.line[1])] };
            }
            text = t;
            var key = t + '\u0000' + (range ? range.para.join() + ',' + range.line.join() : '');
            if (key === drawn) return;
            drawn = key;
            back.textContent = '';
            lineEl = null;
            // a zero-width space gives a trailing empty line its height, as
            // the textarea does
            if (!range) { back.appendChild(piece(t + '\u200b')); return; }
            var a = range.para[0], b = range.para[1];
            var c = Math.max(a, range.line[0]), d = Math.min(b, Math.max(c, range.line[1]));
            back.appendChild(piece(t.slice(0, a)));
            var para = piece('', 'tp-here-para');
            para.appendChild(piece(t.slice(a, c)));
            lineEl = piece(t.slice(c, d), 'tp-here-line');
            para.appendChild(lineEl);
            para.appendChild(piece(t.slice(d, b)));
            back.appendChild(para);
            back.appendChild(piece(t.slice(b) + '\u200b'));
        }
        function sync() { back.scrollTop = ta.scrollTop; back.scrollLeft = ta.scrollLeft; }
        // Keep the bar in the upper part of the editor, unless the operator
        // is in it (typing, or scrolled it by hand just now).
        function follow() {
            if (!lineEl || doc.activeElement === ta || Date.now() - handAt < HAND) return;
            var top = lineEl.offsetTop, h = ta.clientHeight;
            if (!h) return;
            if (top < ta.scrollTop + h * 0.1 || top > ta.scrollTop + h * 0.7) {
                ta.scrollTop = Math.max(0, top - h * 0.3);
                sync();
            }
        }

        ta.addEventListener('scroll', sync);
        ['wheel', 'touchmove', 'pointerdown'].forEach(function (ev) {
            ta.addEventListener(ev, function () { handAt = Date.now(); }, { passive: true });
        });
        ta.addEventListener('input', function () { draw(); sync(); });
        if (typeof ResizeObserver === 'function') new ResizeObserver(function () { style(); sync(); }).observe(ta);
        style();
        draw();

        return {
            // `forText`: the text the range was measured in (the editor may
            // be a keystroke ahead of the prompter)
            set: function (r, forText) {
                range = r ? { para: r.para.slice(), line: r.line.slice() } : null;
                text = forText != null ? forText : ta.value;
                draw(); sync(); follow();
            },
            refresh: function () { style(); draw(); sync(); follow(); },
            // for tests
            lineEl: function () { return lineEl; },
        };
    }

    return { create: create };
});
