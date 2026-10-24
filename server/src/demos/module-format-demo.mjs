// SYLLABUS: ESM vs CJS
// This .mjs file is ESM. Import ESM modules with static/dynamic import.
import path from "node:path";
import { createRequire } from "node:module";
import process from "node:process";

// Use createRequire only when an ESM module needs to consume a CommonJS package.
const require = createRequire(import.meta.url);
const util = require("node:util");

process.stdout.write(`${JSON.stringify({
  esmPathJoin: path.join("tradewise", "server"),
  commonJsInspect: util.inspect({ mode: "CommonJS", loadedFrom: import.meta.url })
})}\n`);
