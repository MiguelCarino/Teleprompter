/* prompter/screens.js — which monitors are there, and opening a window on one (P2, §3 mode 2).

   Chromium has the Window Management API: screen.isExtended says, with no
   prompt, that more than one monitor is connected; getScreenDetails()
   (one permission prompt) lists them with names and positions, so an
   output window can be opened right on the chosen monitor. Elsewhere
   (Firefox, Safari) none of this exists: the output opens as an ordinary
   window, to be dragged across and made full screen with F.

     var scr = TP.screens.create(window, function onChange() {…});
     scr.state();    // { api, extended, permission, list: [{ key, label, primary, current, w, h, … }] }
     scr.detect();   // asks for the permission (needs a click); resolves to state()
     scr.open(url, name, entry);   // window.open, placed on that screen when known

   Classic script: window.TP.screens in a page, module.exports in node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.TP = root.TP || {}; root.TP.screens = api; }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    // window.open features for a window covering the screen's free area.
    function features(entry, granted) {
        var f = ['popup'];
        if (entry) {
            f.push('left=' + Math.round(entry.left), 'top=' + Math.round(entry.top),
                'width=' + Math.round(entry.w), 'height=' + Math.round(entry.h));
            // Chromium opens it straight in full screen where the browser
            // allows that for this permission; elsewhere it is ignored.
            if (granted) f.push('fullscreen');
        } else f.push('width=960', 'height=600');
        return f.join(',');
    }

    // A stable name for a screen: its label, else its size and place.
    function keyOf(s) {
        return (s.label || '') + '@' + s.left + ',' + s.top + ' ' + s.width + 'x' + s.height;
    }

    function entryOf(s, current, i) {
        return {
            key: keyOf(s), label: s.label || '', n: i + 1,
            primary: !!s.isPrimary, internal: !!s.isInternal, current: s === current,
            left: s.availLeft != null ? s.availLeft : s.left, top: s.availTop != null ? s.availTop : s.top,
            w: s.availWidth || s.width, h: s.availHeight || s.height, width: s.width, height: s.height,
        };
    }

    function create(win, onChange) {
        onChange = onChange || function () {};
        var hasApi = typeof win.getScreenDetails === 'function';
        var st = {
            api: hasApi,
            extended: win.screen && typeof win.screen.isExtended === 'boolean' ? win.screen.isExtended : null,
            permission: hasApi ? 'prompt' : 'unsupported',
            list: [],
        };
        var details = null;

        function refresh() {
            if (details) {
                st.list = details.screens.map(function (s, i) { return entryOf(s, details.currentScreen, i); });
                st.extended = st.list.length > 1;
            } else if (win.screen && typeof win.screen.isExtended === 'boolean') st.extended = win.screen.isExtended;
            onChange(st);
        }
        function adopt(d) {
            if (details === d) return;
            details = d;
            st.permission = 'granted';
            d.addEventListener('screenschange', refresh);
            d.addEventListener('currentscreenchange', refresh);
            refresh();
        }
        function detect() {
            if (!hasApi) return Promise.resolve(st);
            return win.getScreenDetails().then(function (d) { adopt(d); return st; }, function () {
                st.permission = 'denied'; refresh(); return st;
            });
        }

        if (win.screen && win.screen.addEventListener) win.screen.addEventListener('change', refresh);
        // Already allowed on an earlier visit: list the screens with no prompt.
        if (hasApi && win.navigator.permissions && win.navigator.permissions.query) {
            win.navigator.permissions.query({ name: 'window-management' }).then(function (p) {
                st.permission = p.state;
                if (p.state === 'granted') detect(); else refresh();
                p.addEventListener('change', function () {
                    st.permission = p.state;
                    if (p.state === 'granted') detect(); else refresh();
                });
            }, function () { /* the name is unknown here */ });
        }

        return {
            state: function () { return st; },
            detect: detect,
            features: function (entry) { return features(entry, st.permission === 'granted'); },
            open: function (url, name, entry) {
                try { return win.open(url, name, features(entry, st.permission === 'granted')); } catch (e) { return null; }
            },
        };
    }

    return { create: create, features: features, keyOf: keyOf };
});
