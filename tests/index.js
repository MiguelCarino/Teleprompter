// Lets `node --test tests/` run the whole folder: node resolves a folder
// argument to its index.js, and this loads every *.test.mjs beside it.
// (`node --test tests/*.test.mjs` works too.)
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.mjs')).sort()) {
    import(pathToFileURL(path.join(__dirname, f)).href);
}
