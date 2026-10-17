import { readFileSync } from "node:fs";
import { init, convertUnit, convertTemp, scaleIngredients } from "./app.js";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

function check(id, cond) {
  if (!cond) { console.log("ECHEC " + id); process.exit(1); }
  console.log("ok " + id);
}

// DOM minimal construit à partir des id de index.html
function makeDoc() {
  const els = {};
  for (const m of html.matchAll(/<(\w+)([^>]*\sid="([^"]+)"[^>]*)>/g)) {
    const val = (m[2].match(/\svalue="([^"]*)"/) || [])[1] || "";
    els[m[3]] = mk(m[1], val, m[2]);
  }
  const ta = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/);
  els["ingredients"].value = ta[1];
  const sel = (id) => {
    const b = html.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)</select>'))[1];
    els[id].value = b.match(/value="([^"]*)"/)[1];
    els[id].options = [...b.matchAll(/value="([^"]*)"/g)].map((x) => x[1]);
  };
  ["unit-from", "unit-to", "temp-from"].forEach(sel);
  return { getElementById: (id) => els[id], createElement: (t) => mk(t, "", ""), els };
}
function mk(tag, value, attrs) {
  const l = {};
  return {
    tag, value, attrs, children: [], _text: "",
    get textContent() { return this._text + this.children.map((c) => c.textContent).join("\n"); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); },
    addEventListener(t, f) { (l[t] ||= []).push(f); },
    fire(t) { (l[t] || []).forEach((f) => f()); },
  };
}
const mem = () => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };
function set(el, v) { el.value = v; el.fire("input"); el.fire("change"); }
const alertOk = (d, id) => /role="alert"/.test(html.match(new RegExp('<[^>]*id="' + id + '"[^>]*>'))[0]) && d.els[id].textContent.length > 0;

// Page : structure
check("page", /<title>Convertisseur de cuisine<\/title>/.test(html) && /name="viewport" content="width=device-width, initial-scale=1"/.test(html)
  && !/<style|\sstyle=|\sonclick=/.test(html) && !/overflow-x\s*:\s*(hidden|clip)/.test(css) && /box-sizing:\s*border-box/.test(css));

let d = makeDoc(); init(d, mem());

// AC-1
set(d.els["unit-value"], "2"); set(d.els["unit-from"], "tasse"); set(d.els["unit-to"], "ml");
check("AC-1", d.els["unit-result"].textContent === "480 ml" && convertUnit("2", "tasse", "ml").text === "480 ml");

// AC-2
set(d.els["unit-value"], "100"); set(d.els["unit-from"], "g"); set(d.els["unit-to"], "oz");
check("AC-2", d.els["unit-result"].textContent === "3,5 oz");

// AC-3
set(d.els["temp-value"], "350"); set(d.els["temp-from"], "F");
check("AC-3", d.els["temp-result"].textContent === "177 °C");

// AC-4
set(d.els["temp-value"], "180"); set(d.els["temp-from"], "C");
check("AC-4", d.els["temp-result"].textContent === "356 °F");

// AC-5
set(d.els["base-people"], "4"); set(d.els["target-people"], "6"); set(d.els["ingredients"], "200 g farine");
check("AC-5", d.els["recipe-result"].children[0].textContent === "300 g farine"
  && scaleIngredients("200 g", "4", "6").lines[0] === "300 g");

// AC-6
set(d.els["unit-value"], "2"); set(d.els["unit-from"], "tasse"); set(d.els["unit-to"], "g");
check("AC-6", d.els["unit-result"].textContent === "" && alertOk(d, "unit-error")
  && /impossible/.test(d.els["unit-error"].textContent));

// AC-7
let ok7 = true;
for (const bad of ["", "-3", "abc", "1e", "   "]) {
  set(d.els["unit-from"], "tasse"); set(d.els["unit-to"], "ml");
  set(d.els["unit-value"], bad);
  ok7 = ok7 && d.els["unit-result"].textContent === "" && alertOk(d, "unit-error")
    && /invalide/.test(d.els["unit-error"].textContent);
}
set(d.els["unit-value"], "2");
ok7 = ok7 && d.els["unit-error"].textContent === "" && d.els["unit-result"].textContent === "480 ml";
check("AC-7", ok7);

// AC-8
const store = mem();
d = makeDoc(); init(d, store);
set(d.els["target-people"], "6");
const d2 = makeDoc(); init(d2, store);
check("AC-8", d2.els["target-people"].value === "6");
