/* prompter/input.js — keys → actions (R7, §5.7). The map is fixed for now;
   remapping and other devices are P4 (on hold).

     TP.input.attach(document, function (action, e) { … return false if unused; });

   Actions: toggle, faster, slower, back, forward, prevPara, nextPara, top,
   reverse, fullscreen, escape, and jump1 … jump9 (keys 1–9: the first nine
   headings and stops, P3). The same map runs in the control page and
   (P2) in every output window.

   A key is left alone when the focused control needs it: text entry keeps
   every key; a checkbox keeps Space; a slider keeps its arrows, Page and
   Home/End keys but not Space; a select keeps its keys; a button or link
   keeps Space and Enter. Classic script: window.TP.input in a page,
   module.exports in node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.TP = root.TP || {}; root.TP.input = api; }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    var KEYS = {
        ' ': 'toggle', 'Spacebar': 'toggle', 'MediaPlayPause': 'toggle',
        'ArrowUp': 'faster', 'ArrowDown': 'slower',
        'ArrowLeft': 'back', 'ArrowRight': 'forward',
        'PageUp': 'prevPara', 'PageDown': 'nextPara',
        'Home': 'top',
        'r': 'reverse', 'R': 'reverse',
        'f': 'fullscreen', 'F': 'fullscreen',
        'Escape': 'escape',
    };
    for (var n = 1; n <= 9; n++) KEYS[String(n)] = 'jump' + n;

    // The action for a keydown, or null. Pure: it reads key and modifiers.
    function actionFor(e) {
        if (!e || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return null;
        return Object.prototype.hasOwnProperty.call(KEYS, e.key) ? KEYS[e.key] : null;
    }

    var TEXT_TYPES = /^(text|search|email|url|tel|password|number|date|datetime-local|month|week|time)$/;
    var SLIDER_KEYS = /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End)$/;

    // True when the focused element should get this key instead of the prompter.
    function ownsKey(tg, key) {
        if (!tg || !tg.closest) return false;
        if (tg.closest('textarea, [contenteditable]:not([contenteditable="false"])')) return true;
        if (tg.closest('select')) return true;
        var inp = tg.closest('input');
        if (inp) {
            var ty = (inp.getAttribute('type') || 'text').toLowerCase();
            if (ty === 'checkbox' || ty === 'radio') return key === ' ';
            if (ty === 'range') return SLIDER_KEYS.test(key);
            if (TEXT_TYPES.test(ty)) return true;
            return key === ' ' || key === 'Enter';   // button-like inputs
        }
        if (tg.closest('button, a[href], summary, [role="button"]')) return key === ' ' || key === 'Enter';
        return false;
    }

    function attach(target, onAction) {
        function onKey(e) {
            if (e.defaultPrevented) return;
            var action = actionFor(e);
            if (!action || ownsKey(e.target, e.key)) return;
            if (onAction(action, e) !== false) e.preventDefault();
        }
        target.addEventListener('keydown', onKey);
        return function detach() { target.removeEventListener('keydown', onKey); };
    }

    return { KEYS: KEYS, actionFor: actionFor, ownsKey: ownsKey, attach: attach };
});
