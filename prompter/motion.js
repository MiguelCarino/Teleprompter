/* prompter/motion.js — time-based motion (fixes R1). Pure: no DOM, no clock.

   Position is in line-heights, measured from the first line sitting on the
   reading line (pos 0) to the last line sitting on it (pos = max). Speed
   is line-heights per second, so the pace does not depend on the refresh
   rate, the text size or the window size. The caller feeds real frame
   times through step(dt); the distance is integrated exactly (not sampled
   per frame), so 60 Hz, 144 Hz and a dropped frame all cover the same
   ground in the same time.

   Speed never jumps: start, stop, reverse and speed changes ease over
   `ramp` seconds (smoothstep velocity). Nudges and animated seeks are
   eased position offsets layered on top, so they work while playing too.

     var m = TP.motion.create({ speed: 0.6 });
     m.setBounds(0, maxLines); m.play();
     // every frame: m.step(dtSeconds) → { moved, ended, top }; read m.pos

   Classic script, like model.js: window.TP.motion in a page, module.exports
   in node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.TP = root.TP || {}; root.TP.motion = api; }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    // Velocity eases with smoothstep s(u) = 3u² − 2u³. Its integral from 0 to
    // u is S(u) = u³ − u⁴/2, which gives the exact distance within a ramp.
    function S(u) { return u * u * u - u * u * u * u / 2; }
    // Position offsets (nudge, seek) follow smoothstep itself.
    function E(u) { return u * u * (3 - 2 * u); }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    var MIN_SPEED = 0.05, MAX_SPEED = 10;

    function create(opts) {
        opts = opts || {};
        var RAMP = opts.ramp != null ? Math.max(0, opts.ramp) : 0.5;
        // A frame longer than this (the tab was hidden, the machine stalled)
        // counts as this long: the text never leaps ahead on return.
        var MAX_DT = opts.maxDt || 0.1;

        var s = {
            pos: 0, min: 0, max: Infinity,
            speed: clamp(opts.speed || 0.6, MIN_SPEED, MAX_SPEED),
            dir: 1, playing: false, ended: false, elapsed: 0,
            v0: 0, v1: 0, u: RAMP,   // ramp from v0 to v1; u = seconds into it
            tweens: [],
        };

        function velocity() {
            if (s.u >= RAMP || RAMP === 0) return s.v1;
            var k = s.u / RAMP;
            return s.v0 + (s.v1 - s.v0) * k * k * (3 - 2 * k);
        }
        function target() { return s.playing ? s.dir * s.speed : 0; }
        function retarget() {
            var cur = velocity(), to = target();
            if (RAMP === 0) { s.v0 = s.v1 = to; return; }
            if (cur === to && s.u >= RAMP) return;
            s.v0 = cur; s.v1 = to; s.u = 0;
        }
        function halt() {
            s.playing = false; s.v0 = s.v1 = 0; s.u = RAMP; s.tweens = [];
        }

        var api = {
            get pos() { return s.pos; },
            get min() { return s.min; },
            get max() { return s.max; },
            get speed() { return s.speed; },
            get ramp() { return RAMP; },
            get direction() { return s.dir; },
            get playing() { return s.playing; },
            get ended() { return s.ended; },
            get elapsed() { return s.elapsed; },
            get velocity() { return velocity(); },
            // 0..1 through the script (0 when there is nothing to scroll).
            get progress() { return s.max > s.min && isFinite(s.max) ? clamp((s.pos - s.min) / (s.max - s.min), 0, 1) : 0; },

            play: function () {
                if (s.ended && s.dir > 0) return false;   // at the end: go back first
                // At the top there is nothing behind: reverse would halt on the
                // first frame, so play forward instead.
                if (s.dir < 0 && s.pos <= s.min) s.dir = 1;
                s.playing = true; retarget(); return true;
            },
            pause: function () { s.playing = false; retarget(); },
            toggle: function () { return s.playing ? (api.pause(), false) : api.play(); },
            // Immediate stop, no coasting (Home, a new script).
            stop: halt,
            setSpeed: function (v) {
                s.speed = clamp(+v || MIN_SPEED, MIN_SPEED, MAX_SPEED);
                if (s.playing) retarget();
                return s.speed;
            },
            reverse: function () {
                s.dir = -s.dir;
                if (s.dir < 0) s.ended = false;
                if (s.playing) retarget();
                return s.dir;
            },
            setDirection: function (d) { if ((d < 0 ? -1 : 1) !== s.dir) api.reverse(); },
            // Move by `lines` over `dur` seconds, on top of any playback.
            nudge: function (lines, dur) {
                if (!lines) return;
                if (lines < 0) s.ended = false;
                s.tweens.push({ delta: lines, t: 0, dur: dur == null ? 0.2 : Math.max(0.001, dur) });
            },
            // Go to `pos` (lines); animated, it eases there over `dur` seconds.
            seek: function (pos, animate, dur) {
                s.tweens = [];
                var to = clamp(pos, s.min, s.max);
                if (to < s.max) s.ended = false;
                if (animate) s.tweens.push({ delta: to - s.pos, t: 0, dur: dur == null ? 0.3 : Math.max(0.001, dur) });
                else s.pos = to;
            },
            // Re-anchor after a relayout: the same words, new line units.
            setPos: function (pos) { s.pos = clamp(pos, s.min, s.max); },
            setBounds: function (min, max) {
                s.min = min; s.max = Math.max(min, max);
                s.pos = clamp(s.pos, s.min, s.max);
                if (s.pos < s.max) s.ended = false;
            },
            // A relayout: new bounds and the re-anchored position together.
            // The end state survives when the position is still at the end
            // (bigger text at the end of a take); it clears only when there
            // is now text left to read. Returns true when `ended` changed.
            setLayout: function (min, max, pos) {
                var was = s.ended;
                s.min = min; s.max = Math.max(min, max);
                s.pos = clamp(pos, s.min, s.max);
                s.ended = was && s.pos >= s.max - 1e-6;
                if (s.ended) s.pos = s.max;
                return s.ended !== was;
            },
            resetElapsed: function () { s.elapsed = 0; },
            // a new lead output carries on the take's clock (P2)
            setElapsed: function (v) { s.elapsed = Math.max(0, +v || 0); },
            setEnded: function (v) { s.ended = !!v; },
            isActive: function () { return s.playing || velocity() !== 0 || s.u < RAMP || s.tweens.length > 0; },

            step: function (dt) {
                if (!(dt > 0)) return { moved: false, ended: false, top: false };
                if (dt > MAX_DT) dt = MAX_DT;
                var d = 0;
                // velocity: the ramped part, then the steady part
                if (s.u < RAMP) {
                    var t1 = Math.min(RAMP, s.u + dt);
                    d += s.v0 * (t1 - s.u) + (s.v1 - s.v0) * RAMP * (S(t1 / RAMP) - S(s.u / RAMP));
                    d += s.v1 * (dt - (t1 - s.u));
                    s.u = t1;
                    if (s.u >= RAMP) s.v0 = s.v1;
                } else {
                    d += s.v1 * dt;
                }
                // eased offsets
                for (var i = s.tweens.length - 1; i >= 0; i--) {
                    var tw = s.tweens[i], e1 = Math.min(tw.dur, tw.t + dt);
                    d += tw.delta * (E(e1 / tw.dur) - E(tw.t / tw.dur));
                    tw.t = e1;
                    if (tw.t >= tw.dur) s.tweens.splice(i, 1);
                }
                if (s.playing) s.elapsed += dt;

                var before = s.pos, endedNow = false, topNow = false, v = velocity();
                s.pos += d;
                if (s.pos >= s.max && d > 0) {
                    s.pos = s.max;
                    // Playing in reverse, a forward nudge only clamps.
                    if (!(v < 0)) {
                        halt();
                        if (!s.ended) endedNow = true;
                        s.ended = true;
                    }
                } else if (s.pos <= s.min && d < 0) {
                    s.pos = s.min;
                    // Reverse playback (or its coast) reaching the top stops
                    // there and turns forward again, so the next play moves.
                    // A backward nudge while playing forward only clamps.
                    if (v < 0 || (s.playing && s.dir < 0)) { halt(); s.dir = 1; topNow = true; }
                }
                return { moved: s.pos !== before, ended: endedNow, top: topNow };
            },
        };
        return api;
    }

    // Approximate words per minute for a speed in lines per second. `lines`
    // is the distance the words are spread over, in the same line units the
    // motion counts: the scroll distance (motion.max), gaps between
    // paragraphs included, not the number of text lines.
    function wpm(linesPerSecond, words, lines) {
        return lines > 0 ? Math.round(linesPerSecond * 60 * words / lines) : 0;
    }

    return { create: create, wpm: wpm, MIN_SPEED: MIN_SPEED, MAX_SPEED: MAX_SPEED };
});
