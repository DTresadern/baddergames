// Shared plumbing for mm: paths, config, clock, lock, JSON files, external commands.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.dirname(SCRIPTS_DIR);
export const TEMPLATES_DIR = path.join(SKILL_DIR, "templates");

export class MmError extends Error {}
export const fail = (message) => { throw new MmError(message); };

export function run(cmd, args, { cwd, input, timeoutMs = 120000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: "utf8", timeout: timeoutMs });
  return {
    code: r.error ? 127 : r.status ?? 1,
    out: (r.stdout || "").trim(),
    err: ((r.stderr || "").trim() || (r.error ? r.error.message : "")),
  };
}

export const git = (args, cwd) => run("git", args, { cwd });

// ---------- locations ----------

export function locate(cwd = process.cwd()) {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (top.code) fail(`not inside a git repository: ${cwd}`);
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd).out;
  const main = path.dirname(common);
  const checkout = top.out;
  const config = loadConfig(checkout, main);
  return {
    cwd: fs.realpathSync(cwd),
    checkout,
    main,
    isWorktree: path.resolve(checkout) !== path.resolve(main),
    config,
    stateDir: process.env.MM_STATE_DIR || path.join(main, ".mastermind", "state"),
    tasksDir: process.env.MM_TASKS_DIR || path.join(main, ".mastermind", "tasks"),
    devlogDir: process.env.MM_DEVLOG_DIR || path.join(main, config.devlogDir || "devlog"),
    mmPath: mmPathFor(checkout, main),
  };
}

// The mm in the main checkout when this script runs from inside the repository, otherwise this mm.
function mmPathFor(checkout, main) {
  const rel = path.relative(checkout, SCRIPTS_DIR);
  return rel.startsWith("..") || path.isAbsolute(rel) ? path.join(SCRIPTS_DIR, "mm") : path.join(main, rel, "mm");
}

function loadConfig(checkout, main) {
  for (const root of [checkout, main]) {
    const p = path.join(root, ".mastermind", "config.json");
    if (fs.existsSync(p)) {
      const c = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const key of ["project", "timezone", "namespaces", "models", "capabilities"]) {
        if (!(key in c)) fail(`${p} has no "${key}"`);
      }
      return c;
    }
  }
  fail(`no .mastermind/config.json in ${checkout} or ${main}`);
}

// ---------- clock (MM_NOW overrides it for tests) ----------

export const now = () => (process.env.MM_NOW ? new Date(process.env.MM_NOW) : new Date());

const fmtCache = new Map();
function fmt(tz, opts) {
  const key = tz + JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }));
  return fmtCache.get(key);
}
function parts(date, tz) {
  const p = Object.fromEntries(fmt(tz, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return p;
}
export function dayKey(date, tz) {
  const p = parts(new Date(date), tz);
  return `${p.year}-${p.month}-${p.day}`;
}
export function clock(date, tz) {
  const p = parts(new Date(date), tz);
  return `${p.hour}:${p.minute}`;
}
export function weekday(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
}
export function longDate(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}
export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function localStamp(date, tz) {
  return `${dayKey(date, tz)} ${clock(date, tz)} (${tz})`;
}

// ---------- files ----------

export function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export function writeJson(p, value) { writeText(p, JSON.stringify(value, null, 2) + "\n"); }
export function writeText(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// One lock for every mm write. A lock whose process is gone is removed.
export function lock(stateDir) {
  const dir = path.join(stateDir, ".lock");
  fs.mkdirSync(stateDir, { recursive: true });
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
      return () => fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let stale = false;
      try {
        const pid = Number(fs.readFileSync(path.join(dir, "pid"), "utf8"));
        try { process.kill(pid, 0); } catch (err) { stale = err.code === "ESRCH"; }
      } catch {
        try { stale = Date.now() - fs.statSync(dir).mtimeMs > 5000; } catch { stale = false; }
      }
      if (stale) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      if (Date.now() > deadline) fail(`timed out waiting for the mm lock: ${dir}`);
      pause(25);
    }
  }
}

// ---------- ledger ----------

export const ledgerPath = (ctx) => path.join(ctx.stateDir, "ledger.json");
export const readLedger = (ctx) => ({ claims: {}, lanes: {}, dailyThreads: {}, ...readJson(ledgerPath(ctx), {}) });
export const writeLedger = (ctx, ledger) => writeJson(ledgerPath(ctx), ledger);

// ---------- T3 and GitHub ----------

const t3bin = () => process.env.MM_T3 || "t3";
const ghbin = () => process.env.MM_GH || "gh";

export function t3(args, input) { return run(t3bin(), args, { input }); }
export function t3Available() { return t3(["--version"]).code === 0; }

// "live" | "settled" | "archived" | "gone" | "unknown" (t3 not available)
export function threadState(id) {
  if (!id) return "gone";
  const r = t3(["thread", "show", id, "--json"]);
  if (r.code === 0) {
    const t = JSON.parse(r.out).thread || {};
    if (t.archived) return "archived";
    if (t.settled) return "settled";
    return "live";
  }
  return t3Available() ? "gone" : "unknown";
}
export function threadInfo(id) {
  const r = t3(["thread", "show", id, "--json"]);
  return r.code === 0 ? JSON.parse(r.out).thread : null;
}
export function currentThreadId() { return process.env.MM_THREAD_ID || process.env.T3CODE_THREAD_ID || null; }

export function gh(ctx, args) { return run(ghbin(), args, { cwd: ctx.main }); }
export function ghJson(ctx, args) {
  const r = gh(ctx, args);
  if (r.code) fail(`gh ${args.join(" ")} failed: ${r.err || r.out}`);
  return r.out ? JSON.parse(r.out) : null;
}

// ---------- namespaces ----------

export function namespaces(ctx) {
  return Object.entries(ctx.config.namespaces)
    .map(([name, root]) => ({ name, root: root === "." ? "" : root.replace(/\/+$/, "") }))
    .sort((a, b) => b.name.length - a.name.length);
}
export function nsInfo(ctx, name) {
  const ns = namespaces(ctx).find((n) => n.name === name);
  if (!ns) fail(`unknown namespace "${name}". Known: ${namespaces(ctx).map((n) => n.name).join(", ")}`);
  return ns;
}
export const nsShort = (ctx, name) => (name === ctx.config.project ? name.split(".").pop() : name.slice(ctx.config.project.length + 1));

// The longest registered namespace that the title starts with, followed by the end or a separator.
export function nsFromTitle(ctx, title) {
  if (!title) return null;
  const hit = namespaces(ctx).find((n) => title === n.name || title.startsWith(n.name + " ") || title.startsWith(n.name + "·"));
  return hit ? hit.name : null;
}
export function nsFromPath(ctx, absPath) {
  const rel = path.relative(ctx.checkout, absPath);
  if (rel.startsWith("..")) return null;
  const hit = namespaces(ctx).find((n) => n.root === "" || rel === n.root || rel.startsWith(n.root + path.sep));
  return hit ? hit.name : null;
}

// ---------- templates ----------

export function fillTemplate(name, vars) {
  const text = fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf8");
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) fail(`template ${name} uses {{${key}}} but no value was given`);
    return String(vars[key]);
  });
}
