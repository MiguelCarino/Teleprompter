/* prompter/link.js — the windows talk over one BroadcastChannel (§4.4).

   The control page and every output.html window join the same channel.
   It is same-origin and survives a reload of either side. Messages are
   plain objects, versioned: { v: 1, type, from, to?, … }. A message with
   a `to` is for that window only; without one it is for everyone.

     var link = TP.link.open('control', function (msg) { … });
     link.send({ type: 'script', text });            // everyone
     link.send({ type: 'cmd', to: 'o1', action });   // one window
     link.close();

   Types (who sends → who reads):
     control  control → all     heartbeat, once a second; `lead` = who drives
     hello    output → all      I'm here (also after a reload): id, screen, w, h
     bye      output → all      the window is closing
     script   control → output  the full text (scripts are small: no diffing)
     settings control → output  that output's effective render settings + labels
     lead     control → all     who drives the scroll now, and where it was
     cmd      control → lead    transport: toggle, top, nudge, paragraph, reverse, speed…
     key      output → control  a key pressed in an output (the control routes it)
     pos      lead → all        { anchor, vel, sl, playing, dir, ended, countdown, … }
     identify control → output  show the output's number for a moment

   Pure helpers (followTarget) are here too, so node tests reach them.
   Classic script: window.TP.link in a page, module.exports in node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.TP = root.TP || {}; root.TP.link = api; }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    var NAME = 'carino-teleprompter', V = 1;

    function supported() { return typeof BroadcastChannel === 'function'; }

    // null when the browser has no BroadcastChannel (or it throws, as on
    // some file:// pages): the page then runs as a single window.
    function open(id, onMessage, Channel) {
        // tests pass their own channel class, or null for "none"
        if (Channel === undefined) Channel = typeof BroadcastChannel === 'function' ? BroadcastChannel : null;
        if (!Channel) return null;
        var ch;
        try { ch = new Channel(NAME); } catch (e) { return null; }
        ch.onmessage = function (e) {
            var m = e.data;
            if (!m || m.v !== V || typeof m.type !== 'string' || m.from === id) return;
            if (m.to && m.to !== id) return;
            onMessage(m);
        };
        return {
            id: id,
            send: function (msg) {
                msg.v = V; msg.from = id;
                try { ch.postMessage(msg); } catch (e) { /* closed, or not cloneable */ }
            },
            close: function () { try { ch.close(); } catch (e) { /* already closed */ } },
        };
    }

    // Where a follower should be now, from the lead's last `pos`.
    // The lead counts in its own line-heights; a follower with another
    // text size wraps differently, so the lead's velocity is scaled by the
    // ratio of the two scroll lengths (sl, in lines) and converted to the
    // follower's pixels. y0 is the follower's y for the lead's anchor.
    //   f = { y0, lh, sl, top, end }   (the follower's own layout)
    function followTarget(pos, f, nowWall) {
        var dt = Math.max(0, Math.min(2, (nowWall - pos.t) / 1000));
        var ratio = pos.sl > 0 && f.sl > 0 ? f.sl / pos.sl : 1;
        var y = f.y0 + (pos.vel || 0) * f.lh * ratio * dt;
        return y < f.top ? f.top : y > f.end ? f.end : y;
    }

    // A short id for a new output window.
    function newId(n, rnd) { return 'o' + n + '-' + Math.floor(rnd * 1e6).toString(36); }

    return { NAME: NAME, V: V, supported: supported, open: open, followTarget: followTarget, newId: newId };
});
