import { split } from "./app.js";
import { readFileSync } from "node:fs";
const t = split(["a", "b", "c", "d", " "], 2);
if (t.length !== 2 || t.flat().length !== 4) process.exit(1);
console.log("ok AC-1");
if (!readFileSync("index.html", "utf8").includes('id="go"')) process.exit(1);
console.log("ok AC-2");
