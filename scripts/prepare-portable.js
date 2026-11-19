// Puts ArrDeck's portable launcher script (build/portable.nsi: electron-builder's own, plus a
// "bring the running ArrDeck back instead of unpacking again" shortcut) where electron-builder
// reads it. electron-builder has no option for a custom portable script, so this runs before
// every build (npm run dist). The original is kept as portable.nsi.orig.
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "node_modules", "app-builder-lib", "templates", "nsis");
const target = path.join(dir, "portable.nsi");
const ours = path.join(__dirname, "..", "build", "portable.nsi");
if (!fs.existsSync(target + ".orig")) fs.copyFileSync(target, target + ".orig");
fs.copyFileSync(ours, target);
console.log("portable launcher: ArrDeck's version in place");
