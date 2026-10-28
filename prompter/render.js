/* prompter/render.js — blocks → DOM inside one output surface.

   One renderer owns one container element (the "output"): the present
   view today, a separate output.html window in P2. It draws the script
   from a model.js parse with DOM text nodes only (never innerHTML, so a
   script can never become markup), the reading line, the dim of passed
   text, the countdown and the end marker.

   Position is an ANCHOR, not pixels: { offset, frac }.
     offset  character offset into the script text; after a move it is the
             first character of the line on the reading line
     frac    how far through that line (in line-heights) the reading line
             is: 0 = the line's top edge, 0.5 = its middle, 1 = its bottom.
             It can be < 0 in the gap above a paragraph (the anchor is then
             that paragraph's first character) and > 1 past the last line.
   Content y (px from the top of the text column) and the anchor convert
   both ways: y = lineTop(line holding offset) + frac × lineHeight. Each
   output converts the same anchor with its own layout, so two outputs
   with different sizes show the same words on their reading lines, and
   a size, font or margin change keeps the reader's place.

   Text moves with transform: translate3d() at sub-pixel values (R2);
   nothing scrolls. Every line is exactly lineHeight px tall (an integer)
   and paragraphs are one empty line apart, so the whole layout is in
   line units, which is what motion.js counts in.

     var r = TP.render.create(el, { onLayout(y) {…} });
     r.setSettings({ size, spacing, margin, font, mirror, flip, linePos, lineStyle, dim, headings });
     r.setModel(TP.model.parse(text), anchor);   // anchor optional
     r.setModel(next, c.anchor, c.edit);         // an edit (TP.model.carry)
     r.setY(y);  r.anchor();  r.yFor(anchor);  r.topY();  r.endY();  r.paraYs();  r.scrollLines();
     r.stopYs();  r.reading();  r.offsetAt(node);

   Headings show smaller (same line height, so the layout stays in line
   units) or, with headings: 'hidden', are left out of the layout. A stop
   is one empty line with a rule across it.

   An edit that touches the line on the reading line rewrites that line in
   place (§5.3): the reader stays on the same line of the same paragraph,
   whatever it now says, and only the text below moves if the paragraph
   wraps to more or fewer lines. Any other edit keeps the anchor (mapped
   through the edit), so the words on the reading line stay put.

   The layout math below (paraIndexAt / anchorFromY / yFromAnchor) is pure
   and tested in node; the DOM half feeds it measurements. Classic script:
   window.TP.render in a page, module.exports in node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.TP = root.TP || {}; root.TP.render = api; }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    // ---------------------------------------------------------------
    // Pure layout math. A layout is { lh, paras: [{ top, lines, start, end }] }:
    // each paragraph's top (px), its number of lines, and its text range.
    // lineStart(i, li) → offset of the first character of line li of para i;
    // lineOf(i, offset) → which line of para i holds that offset.
    // ---------------------------------------------------------------
    function paraIndexAt(paras, y) {           // last para with top <= y, or -1
        var lo = 0, hi = paras.length - 1, ans = -1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (paras[mid].top <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return ans;
    }
    function paraIndexOfOffset(paras, offset) { // as model.blockIndexAt
        var lo = 0, hi = paras.length - 1, ans = 0;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (paras[mid].start <= offset) { ans = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (offset >= paras[ans].end && ans < paras.length - 1) ans++;
        return ans;
    }
    function anchorFromY(L, y, lineStart) {
        var P = L.paras, lh = L.lh;
        if (!P.length) return { offset: 0, frac: y / lh };
        var i = paraIndexAt(P, y);
        if (i < 0) return { offset: P[0].start, frac: (y - P[0].top) / lh };
        var p = P[i], rel = (y - p.top) / lh;
        if (rel >= p.lines && i < P.length - 1) {     // the gap below p belongs to the next paragraph
            var q = P[i + 1];
            return { offset: q.start, frac: (y - q.top) / lh };
        }
        var li = clamp(Math.floor(rel), 0, p.lines - 1);
        return { offset: li === 0 ? p.start : lineStart(i, li), frac: rel - li };
    }
    // y with the first / last line centred on the reading line, and the
    // scroll distance between the two in line units: text lines plus the
    // one-line gaps between paragraphs, minus one. That distance is what
    // motion.js counts as max, and what a words-per-minute figure divides by.
    function topYOf(L) { return L.paras.length ? L.paras[0].top + L.lh / 2 : L.lh / 2; }
    function endYOf(L) {
        var P = L.paras;
        if (!P.length) return L.lh / 2;
        var p = P[P.length - 1];
        return p.top + (p.lines - 0.5) * L.lh;
    }
    function scrollLines(L) { return Math.max(0, (endYOf(L) - topYOf(L)) / L.lh); }

    // ---- following another output (P2) ----
    // Outputs of different sizes wrap the same paragraph into different
    // numbers of lines, so a character offset is a poor thing to follow:
    // a follower placed by "the first character of the lead's line" leaps
    // whenever that line changes, and skips its own extra lines when the
    // lead reaches a paragraph's end (worst on a portrait monitor).
    // Instead the lead says where it is INSIDE its paragraph:
    //   { para, rel, pl, ppl }  paragraph index; lines from its top (past
    //   `pl` is the one-line gap below it); its line count on the lead, and
    //   the previous paragraph's (`ppl`).
    // A follower walks the same BLOCK at an even pace: a block runs from
    // one paragraph's first line on the reading line to the next one's, so
    // every paragraph starts at the same moment on every output, the speed
    // is constant inside a block (no stall in the gap), and the whole map
    // is continuous: a follower never jumps. The last paragraph maps its
    // first line to its last, so every output ends together.
    function locate(L, y) {
        var P = L.paras;
        if (!P.length) return { para: 0, rel: y / L.lh, pl: 1, ppl: 0 };
        var i = Math.max(0, paraIndexAt(P, y));
        return { para: i, rel: (y - P[i].top) / L.lh, pl: P[i].lines, ppl: i ? P[i - 1].lines : 0 };
    }
    // the pace ratio of a block: follower lines per lead line
    function blockK(pl, plf, last) {
        if (last && pl >= 2) return (plf - 1) / (pl - 1);
        return (plf + 1) / (pl + 1);
    }
    // lines into a paragraph on the lead → lines into the same paragraph on
    // a follower (plf / pplf: the follower's counts; ppl 0 = no previous)
    function mapRel(rel, pl, plf, ppl, pplf, last) {
        if (rel >= 0.5) return 0.5 + (rel - 0.5) * blockK(pl, plf, last);
        // the top half of the first line still belongs to the previous block
        var k0 = ppl > 0 ? blockK(ppl, pplf, false) : 1;
        return 0.5 - (0.5 - rel) * k0;
    }
    // Move a location by `d` of the lead's lines. In a paragraph the lead
    // has not described yet, the follower's own count stands in (the next
    // message comes within 80 ms anyway).
    function advance(L, loc, d) {
        var P = L.paras, i = loc.para, rel = loc.rel + d, pl = loc.pl, ppl = loc.ppl || 0;
        if (!P.length) return { para: 0, rel: rel, pl: pl, ppl: 0 };
        i = clamp(i, 0, P.length - 1);
        while (rel >= pl + 1 && i < P.length - 1) { rel -= pl + 1; i++; ppl = pl; pl = P[i].lines; }
        while (rel < 0 && i > 0) { i--; pl = ppl || P[i].lines; ppl = i ? P[i - 1].lines : 0; rel += pl + 1; }
        return { para: i, rel: rel, pl: pl, ppl: ppl };
    }
    function place(L, loc) {
        var P = L.paras;
        if (!P.length) return loc.rel * L.lh;
        var i = clamp(loc.para, 0, P.length - 1), same = i === loc.para;
        var pl = Math.max(1, same ? loc.pl : P[i].lines);
        var ppl = i ? (same && loc.ppl ? loc.ppl : P[i - 1].lines) : 0;
        return P[i].top + mapRel(loc.rel, pl, P[i].lines, ppl, i ? P[i - 1].lines : 0, i === P.length - 1) * L.lh;
    }
    // ---- the in-line rewrite (P3, §5.3) ----
    // Does an edit [p, oldEnd) touch the line [ls, le)? Typing at either
    // end of the line counts: it is the same caret position.
    function touchesLine(d, ls, le) { return d.p <= le && d.oldEnd >= ls; }
    // The same line (and the same point in it) of a paragraph that now
    // wraps to `lines` lines: the last line if it has fewer now.
    function keepLine(rel, lines) {
        var li = Math.floor(rel), f = rel - li;
        return Math.min(li, Math.max(0, lines - 1)) + f;
    }

    function yFromAnchor(L, a, lineOf) {
        var P = L.paras, lh = L.lh;
        if (!P.length) return a.frac * lh;
        var i = paraIndexOfOffset(P, a.offset), p = P[i], li;
        if (a.offset < p.start) li = 0;                       // in the gap above p
        else li = clamp(lineOf(i, Math.min(a.offset, p.end - 1)), 0, p.lines - 1);
        return p.top + (li + a.frac) * lh;
    }

    // ---------------------------------------------------------------
    // DOM half
    // ---------------------------------------------------------------
    var FONTS = {
        display: "var(--display, 'Red Hat Display', 'IBM Plex Sans', sans-serif)",
        sans: "var(--sans, 'IBM Plex Sans', system-ui, sans-serif)",
        mono: "var(--mono, 'IBM Plex Mono', ui-monospace, monospace)",
    };
    var STYLES = ['line', 'arrows', 'band', 'hidden'];
    var DEFAULTS = { size: 96, spacing: 1.25, margin: 8, font: 'display', mirror: false, flip: false, linePos: 40, lineStyle: 'arrows', dim: false, headings: 'small' };

    // The output's own CSS, injected once per document so a chrome-less
    // output page needs nothing but this file. White on black, no gold.
    var CSS = ''
        + '.tp-out{position:relative;overflow:hidden;background:#000;color:#fff;--tp-cue:#ef4444;-webkit-user-select:none;user-select:none;}'
        + '.tp-flip{position:absolute;inset:0;}'
        + '.tp-flip.tp-mx{transform:scaleX(-1);}.tp-flip.tp-fy{transform:scaleY(-1);}.tp-flip.tp-mx.tp-fy{transform:scale(-1,-1);}'
        + '.tp-track{position:absolute;top:0;left:var(--tp-margin);right:var(--tp-margin);will-change:transform;'
        + 'font-family:var(--tp-font);font-size:var(--tp-size);line-height:var(--tp-lh);font-weight:500;text-align:center;'
        + 'white-space:pre-wrap;overflow-wrap:anywhere;-webkit-font-smoothing:antialiased;}'
        + '.tp-p{margin:0 0 var(--tp-lh);}'
        + '.tp-cue{color:var(--tp-cue);}'
        // a heading keeps the line height, so it still fills whole lines
        + '.tp-h{font-size:calc(var(--tp-size)*.5);font-weight:600;letter-spacing:.08em;color:#9a9a9a;}'
        + '.tp-stop{position:relative;height:var(--tp-lh);}'
        + '.tp-stop::before{content:"";position:absolute;left:12%;right:12%;top:calc(50% - 2px);height:4px;border-radius:2px;background:#6b6b6b;}'
        + '.tp-end{margin:0;font-family:var(--mono,monospace);font-size:max(14px,calc(var(--tp-size)*.3));letter-spacing:.14em;'
        + 'text-transform:uppercase;color:#8a8a8a;border-top:2px solid #3a3a3a;padding-top:calc(var(--tp-lh)*.3);}'
        + '.tp-out.tp-ended .tp-end{color:#fff;border-top-color:#fff;}'
        + '.tp-dim{position:absolute;left:0;right:0;top:0;height:max(0px,calc(var(--tp-r) - var(--tp-lh)/2));background:rgba(0,0,0,.62);pointer-events:none;}'
        + '.tp-line{position:absolute;left:0;right:0;top:var(--tp-r);height:0;pointer-events:none;}'
        // "line" is drawn under the line being read (an underline), so it
        // never strikes through the words on the reading line.
        + '.tp-line[data-style=line]::before{content:"";position:absolute;left:0;right:0;top:calc(var(--tp-lh)/2 - 1px);height:2px;background:rgba(255,255,255,.5);}'
        + '.tp-line[data-style=band]::before{content:"";position:absolute;left:0;right:0;top:calc(var(--tp-lh)/-2);height:var(--tp-lh);'
        + 'background:rgba(255,255,255,.07);border-top:1px solid rgba(255,255,255,.28);border-bottom:1px solid rgba(255,255,255,.28);box-sizing:border-box;}'
        + '.tp-line[data-style=arrows]::before,.tp-line[data-style=arrows]::after{content:"";position:absolute;top:0;width:0;height:0;'
        + 'border-style:solid;transform:translateY(-50%);--a:min(calc(var(--tp-lh)*.26),40px);}'
        + '.tp-line[data-style=arrows]::before{left:6px;border-width:var(--a) 0 var(--a) calc(var(--a)*1.5);border-color:transparent transparent transparent #fff;}'
        + '.tp-line[data-style=arrows]::after{right:6px;border-width:var(--a) calc(var(--a)*1.5) var(--a) 0;border-color:transparent #fff transparent transparent;}'
        + '.tp-count{position:absolute;left:50%;top:var(--tp-r);transform:translate(-50%,-50%);min-width:1.6em;padding:0 .3em;'
        + 'font-family:var(--mono,monospace);font-weight:700;font-size:clamp(48px,calc(var(--tp-lh)*1.6),40vh);line-height:1.3;text-align:center;'
        + 'color:#fff;background:rgba(0,0,0,.82);border:2px solid #fff;border-radius:.2em;pointer-events:none;}';

    function injectCss(doc) {
        if (doc.getElementById('tp-render-css')) return;
        var st = doc.createElement('style');
        st.id = 'tp-render-css';
        st.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(st);
    }

    function create(container, opts) {
        opts = opts || {};
        var doc = container.ownerDocument;
        injectCss(doc);
        function el(tag, cls) { var e = doc.createElement(tag); if (cls) e.className = cls; return e; }

        container.classList.add('tp-out');
        container.textContent = '';
        var flip = el('div', 'tp-flip'), track = el('div', 'tp-track'), endEl = el('p', 'tp-end');
        var dim = el('div', 'tp-dim'), line = el('div', 'tp-line'), count = el('div', 'tp-count');
        count.hidden = true; dim.hidden = true;
        count.setAttribute('aria-live', 'off');
        endEl.textContent = 'End of script';
        flip.appendChild(track); flip.appendChild(dim); flip.appendChild(line); flip.appendChild(count);
        container.appendChild(flip);

        var settings = Object.assign({}, DEFAULTS);
        var model = { text: '', blocks: [], words: 0 };
        var paras = [];                 // [{ el, text, start, end, segs: [{ node, start, end }] }]
        var L = { lh: 100, paras: [] }; // measured layout
        var W = 0, H = 0, R = 0, trackH = -1, totalLines = 0;
        var y = 0, anchor = { offset: 0, frac: 0.5 }, stops = [];
        var memo = null;                // last line looked up by anchorFromY
        var range = doc.createRange();

        // ---- measuring ----
        function segAt(p, k) {
            var sg = p.segs;
            for (var i = 0; i < sg.length; i++) if (k < sg[i].end) return sg[i];
            return sg[sg.length - 1];
        }
        // Which line of paragraph i holds character k. The character's box is
        // compared with the paragraph's box as a ratio, so the preview's
        // scale, the scroll transform and mirroring do not matter.
        function lineOf(i, k) {
            var p = paras[i], n = L.paras[i].lines;
            if (n <= 1) return 0;
            var pr = p.el.getBoundingClientRect();
            if (!pr.height) return 0;
            for (; k >= p.start; k--) {
                var sg = segAt(p, k), local = k - sg.start;
                if (local < 0 || local >= sg.node.length) continue;
                range.setStart(sg.node, local); range.setEnd(sg.node, local + 1);
                var rs = range.getClientRects();
                if (!rs.length) continue;       // a bare newline: it belongs to the line it ends
                var r = rs[0], ratio = ((r.top + r.bottom) / 2 - pr.top) / pr.height;
                if (settings.flip) ratio = 1 - ratio;
                return clamp(Math.floor(ratio * n), 0, n - 1);
            }
            return 0;
        }
        function lineStart(i, li) {
            if (memo && memo.i === i && memo.li === li) return memo.offset;
            var p = paras[i], lo = p.start, hi = p.end - 1, ans = p.end - 1;
            while (lo <= hi) {
                var mid = (lo + hi) >> 1;
                if (lineOf(i, mid) >= li) { ans = mid; hi = mid - 1; } else lo = mid + 1;
            }
            memo = { i: i, li: li, offset: ans };
            return ans;
        }

        function measure() {
            W = container.clientWidth; H = container.clientHeight;
            R = H * settings.linePos / 100;
            var lh = L.lh;
            totalLines = 0;
            L.paras = paras.map(function (p) {
                var lines = Math.max(1, Math.round(p.el.offsetHeight / lh));
                totalLines += lines;
                return { top: p.el.offsetTop, lines: lines, start: p.start, end: p.end };
            });
            trackH = track.offsetHeight;
            memo = null;
            stops = [];
            for (var i = 0; i < paras.length; i++) if (paras[i].kind === 'stop') stops.push(L.paras[i].top + lh / 2);
            container.style.setProperty('--tp-r', R + 'px');
        }
        function layoutChanged() {
            return container.clientWidth !== W || container.clientHeight !== H || track.offsetHeight !== trackH;
        }
        function write() {
            track.style.transform = 'translate3d(0,' + (R - y) + 'px,0)';
        }
        // Re-measure and put the same anchor back on the reading line.
        function relayout() {
            measure();
            y = yFromAnchor(L, anchor, lineOf);
            write();
            if (opts.onLayout) opts.onLayout(y);
        }

        function applySettings() {
            var s = settings, cs = container.style;
            L.lh = Math.max(1, Math.round(s.size * s.spacing));
            cs.setProperty('--tp-size', s.size + 'px');
            cs.setProperty('--tp-lh', L.lh + 'px');
            cs.setProperty('--tp-margin', s.margin + '%');
            cs.setProperty('--tp-font', FONTS[s.font] || FONTS.display);
            flip.classList.toggle('tp-mx', !!s.mirror);
            flip.classList.toggle('tp-fy', !!s.flip);
            line.dataset.style = STYLES.indexOf(s.lineStyle) >= 0 ? s.lineStyle : 'arrows';
            dim.hidden = !s.dim;
        }

        function makePara(text, b) {
            var p = el('p', 'tp-p' + (b.kind === 'heading' ? ' tp-h' : b.kind === 'stop' ? ' tp-stop' : '')), segs = [];
            b.runs.forEach(function (r) {
                var tn = doc.createTextNode(text.slice(r.start, r.end));
                if (r.cue) { var sp = el('span', 'tp-cue'); sp.appendChild(tn); p.appendChild(sp); }
                else p.appendChild(tn);
                segs.push({ node: tn, start: r.start, end: r.end });
            });
            return { el: p, text: text.slice(b.start, b.end), kind: b.kind || 'text', start: b.start, end: b.end, segs: segs };
        }
        function shift(p, d) {
            if (!d) return p;
            p.start += d; p.end += d;
            for (var k = 0; k < p.segs.length; k++) { p.segs[k].start += d; p.segs[k].end += d; }
            return p;
        }
        // An edit rebuilds only the paragraphs it touched: the unchanged run
        // of paragraphs before it and after it keep their elements (their
        // offsets move by the edit's length). A paragraph's runs depend on
        // its text alone, so the same text means the same DOM. This keeps a
        // keystroke in a long script cheap while the text is moving.
        // The blocks on show: hidden headings take no room at all.
        function shown() {
            if (settings.headings !== 'hidden') return model.blocks;
            return model.blocks.filter(function (b) { return b.kind !== 'heading'; });
        }
        function build() {
            var text = model.text, nb = shown(), old = paras;
            var n = Math.min(old.length, nb.length), i = 0, j = 0;
            while (i < n && old[i].start === nb[i].start && old[i].end === nb[i].end
                && old[i].text === text.slice(nb[i].start, nb[i].end)) i++;
            while (j < n - i) {
                var o = old[old.length - 1 - j], b = nb[nb.length - 1 - j];
                if (o.end - o.start !== b.end - b.start || o.text !== text.slice(b.start, b.end)) break;
                j++;
            }
            var before = j ? old[old.length - j].el : endEl;
            for (var k = i; k < old.length - j; k++) track.removeChild(old[k].el);
            if (!endEl.parentNode) track.appendChild(endEl);
            var mid = [], frag = doc.createDocumentFragment();
            for (k = i; k < nb.length - j; k++) { var np = makePara(text, nb[k]); mid.push(np); frag.appendChild(np.el); }
            track.insertBefore(frag, before);
            var tail = old.slice(old.length - j).map(function (p, q) { return shift(p, nb[nb.length - j + q].start - p.start); });
            paras = old.slice(0, i).concat(mid, tail);
        }

        // Layout follows the container (window resize, fullscreen, the
        // preview frame) and the text column (web fonts arriving).
        function check() { if (layoutChanged()) relayout(); }
        if (typeof ResizeObserver === 'function') {
            var ro = new ResizeObserver(check);
            ro.observe(container); ro.observe(track);
        } else if (doc.defaultView) doc.defaultView.addEventListener('resize', check);
        if (doc.fonts && doc.fonts.addEventListener) doc.fonts.addEventListener('loadingdone', relayout);

        // Where the reading line is in the text: its paragraph and the line
        // on it, as offsets (the control's "you are here" bar).
        function lineRange(i, li) {
            var n = L.paras[i].lines;
            return [li === 0 ? paras[i].start : lineStart(i, li), li + 1 < n ? lineStart(i, li + 1) : paras[i].end];
        }
        function reading() {
            if (!paras.length) return null;
            var loc = locate(L, y), i = loc.para, n = L.paras[i].lines;
            // in the gap below a paragraph the next one is coming up
            if (loc.rel >= n && i < paras.length - 1) return { para: [paras[i + 1].start, paras[i + 1].end], line: lineRange(i + 1, 0), gap: true };
            var li = clamp(Math.floor(loc.rel), 0, n - 1);
            return { para: [paras[i].start, paras[i].end], line: lineRange(i, li), gap: loc.rel < 0 || loc.rel >= n };
        }

        // An edit (model.carry): on the reading line, keep that line; else
        // keep the anchor. Measured before the DOM changes.
        function lockFor(edit) {
            if (!edit || edit.block < 0 || !paras.length) return null;
            var ob = model.blocks[edit.block];
            if (!ob) return null;
            var loc = locate(L, y), i = loc.para;
            if (paras[i].start !== ob.start || loc.rel < 0 || loc.rel >= L.paras[i].lines) return null;
            var r = lineRange(i, Math.floor(loc.rel));
            return touchesLine(edit.d, r[0], r[1]) ? loc : null;
        }

        var api = {
            setSettings: function (patch) {
                var hid = settings.headings;
                Object.assign(settings, patch || {});
                applySettings();
                if (settings.headings !== hid) build();
                relayout();
            },
            settings: function () { return Object.assign({}, settings); },
            // New text. Without an anchor it starts at the top.
            setModel: function (m, a, edit) {
                var lock = lockFor(edit);
                model = m || { text: '', blocks: [], words: 0 };
                anchor = a ? { offset: a.offset, frac: a.frac } : { offset: 0, frac: 0.5 };
                build();
                if (!lock) return relayout();
                measure();
                var i = clamp(lock.para, 0, L.paras.length - 1);
                y = L.paras[i].top + keepLine(lock.rel, L.paras[i].lines) * L.lh;
                anchor = anchorFromY(L, y, lineStart);
                write();
                if (opts.onLayout) opts.onLayout(y);
            },
            // Put content y on the reading line. Returns false when the layout
            // had changed under it: the renderer re-anchored instead (and
            // called onLayout), so the caller resyncs from that.
            setY: function (ny) {
                if (layoutChanged()) { relayout(); return false; }
                if (ny === y) return true;
                y = ny;
                anchor = anchorFromY(L, y, lineStart);
                write();
                return true;
            },
            setAnchor: function (a) { anchor = { offset: a.offset, frac: a.frac }; relayout(); },
            anchor: function () { return { offset: anchor.offset, frac: anchor.frac }; },
            anchorAt: function (yy) { return anchorFromY(L, yy, lineStart); },
            yFor: function (a) { return yFromAnchor(L, a, lineOf); },
            y: function () { return y; },
            lineHeight: function () { return L.lh; },
            // y with the first / last line centred on the reading line
            topY: function () { return topYOf(L); },
            endY: function () { return endYOf(L); },
            scrollLines: function () { return scrollLines(L); },
            // where y is inside its paragraph, and back (following, P2)
            locate: function (yy) { return locate(L, yy == null ? y : yy); },
            place: function (loc) { return place(L, loc); },
            advance: function (loc, d) { return advance(L, loc, d); },
            paraYs: function () { return L.paras.map(function (p) { return p.top + L.lh / 2; }); },
            // y of each stop's line centred on the reading line
            stopYs: function () { return stops.slice(); },
            reading: reading,
            // the start offset of the paragraph holding a node (a click)
            offsetAt: function (node) {
                for (var i = 0; i < paras.length; i++) if (paras[i].el === node || paras[i].el.contains(node)) return paras[i].start;
                return null;
            },
            lineCount: function () { return totalLines; },
            words: function () { return model.words; },
            setCountdown: function (n) {
                count.hidden = n == null;
                if (n != null) count.textContent = String(n);
            },
            setEnded: function (on) { container.classList.toggle('tp-ended', !!on); },
            setLabels: function (lbl) { if (lbl && lbl.end) endEl.textContent = lbl.end; },
            relayout: relayout,
            check: check,
        };
        applySettings();
        return api;
    }

    return {
        create: create,
        DEFAULTS: DEFAULTS, FONTS: FONTS, STYLES: STYLES,
        // pure layout math, exported for tests
        paraIndexAt: paraIndexAt, anchorFromY: anchorFromY, yFromAnchor: yFromAnchor,
        topYOf: topYOf, endYOf: endYOf, scrollLines: scrollLines,
        locate: locate, mapRel: mapRel, advance: advance, place: place,
        touchesLine: touchesLine, keepLine: keepLine,
    };
});
