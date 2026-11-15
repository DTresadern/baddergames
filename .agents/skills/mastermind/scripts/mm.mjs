#!/usr/bin/env node
// mm: deterministic bookkeeping for the mastermind skill. Run `mm help`.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  MmError, SCRIPTS_DIR, currentThreadId, dayKey, fail, git, localStamp, locate, lock, namespaces, now, nsFromPath,
  nsFromTitle, nsInfo, readLedger, threadInfo, threadState, writeLedger,
} from "./core.mjs";
import { NOTE_KINDS, devlogSummaryLine, recordEvent, renderPages, rollover, setSummary } from "./devlog.mjs";
import {
  claim, gitPreflight, issueNew, laneAttach, laneCleanup, laneList, laneMerge, laneNew, laneSet, laneUpdate, nsAdd, owner, reconcile,
  release, syncLanes, taskFind, taskList,
  taskNew, taskStart,
} from "./work.mjs";

const HELP = `mm: mastermind bookkeeping. Every command except help, whoami and ns first closes past devlog days
and reads every open lane's thread, recording what it reports (HELD, WAITING, BLOCKED, …).

  mm whoami [--ns <namespace>] [--json]      namespace, root, files to read, orchestrators, current time
  mm status [--json]                         rollover, lanes by state, what waits on the user, warnings
  mm claim [<namespace>] [--force]           this thread becomes the orchestrator of the namespace
  mm release [<namespace>]

  mm lane new <name> --ns <ns> --title "<few words>" (--issue <n> | --goal-file <f>)
        [--class simple|standard|hard] [--class-reason "<why>"] [--needs image-generation]
        [--provider claude|codex] [--reviewer gristle|r9000|both|none] [--why "<why it matters>"]
  mm lane set <name> [--thread-id <id>] [--task-id <id>] [--issue <n>] [--pr <n>]
  mm lane update <name> <running|held|waiting|blocked|merged|closed|request-lane> [--note "<text>"] [--why "<text>"] [--pr <n>]
  mm lane list [--open] [--json]
  mm lane attach <name>                     run by the lane itself as its first step: records its thread
  mm lane merge <name>                      on the user's word only: merges the held pull request if it is open,
                                            CLEAN and every check passed; then removes the lane's branch and worktree
  mm lane cleanup <name>                    finish removing a merged or closed lane's branches and worktree (safe to repeat)

  mm issue new <ns> "<title>" [--body-file <f>]   GitHub issue with the ns:<name> label
  mm task new <ns> "<title>" [--body-file <f>]    local backlog task
  mm task list [<ns>] | mm task find <words…> | mm task start <ns>/<slug> [--issue <n>]

  mm devlog event <${NOTE_KINDS.join("|")}> "<what>" [--ns <ns>] [--why "<text>"] [--links a,b]
                                                  (lane states are recorded with mm lane update)
  mm devlog summary <YYYY-MM-DD|today> (--file <f> | "<text>")
  mm devlog render [<YYYY-MM-DD>]
  mm devlog thread <YYYY-MM-DD> <thread-id>       record a Daily Update thread made by hand
  mm rollover                                     close past days now

  mm owner <namespace>                            the running orchestrator responsible for a namespace
  mm preflight                                    the git checks a new lane must pass
  mm ns list
  mm ns add <folder>                              new sub-project namespace + its AGENTS.md/CLAUDE.md (run in a lane)
  mm selftest`;

const FLAGS = new Set(["force", "json", "open", "skipGitCheck"]);
const VALUES = new Set(["ns", "title", "issue", "class", "classReason", "needs", "provider", "reviewer", "goalFile", "why",
  "threadId", "taskId", "pr", "note", "bodyFile", "links", "file"]);

function parse(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (FLAGS.has(key)) { opt[key] = true; continue; }
    if (!VALUES.has(key)) fail(`unknown option ${a}. Run mm help.`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) fail(`${a} needs a value`);
    opt[key] = next;
    i++;
  }
  return { pos, opt };
}

const out = (value, asJson) => console.log(asJson || typeof value !== "string" ? JSON.stringify(value, null, 2) : value);
const list = (v) => (v && v !== true ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : []);
const num = (v) => (v == null || v === true ? null : Number(String(v).replace(/^#/, "")) || fail(`not a number: ${v}`));
const day = (ctx, v) => (!v || v === "today" ? dayKey(now(), ctx.config.timezone) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fail(`not a date: ${v}`));

function whoami(ctx, opt) {
  const threadId = currentThreadId();
  const thread = threadId ? threadInfo(threadId).thread : null;
  let ns = null;
  let source = null;
  if (opt.ns) { ns = nsInfo(ctx, opt.ns).name; source = "--ns"; }
  if (!ns && thread) { ns = nsFromTitle(ctx, thread.title); source = ns && "thread title"; }
  if (!ns) { ns = nsFromPath(ctx, ctx.cwd); source = ns && "current folder"; }
  if (!ns) { ns = ctx.config.project; source = "default"; }
  const info = nsInfo(ctx, ns);
  const rootAbs = path.join(ctx.checkout, info.root);
  const read = [path.join(ctx.checkout, "AGENTS.md"), path.join(rootAbs, "AGENTS.md")]
    .filter((p, i, a) => a.indexOf(p) === i && fs.existsSync(p));
  const ledger = readLedger(ctx);
  return {
    namespace: ns, source, root: info.root || ".", rootAbs, checkout: ctx.checkout, mainCheckout: ctx.main,
    isWorktree: ctx.isWorktree, thread: thread ? { id: threadId, title: thread.title } : threadId ? { id: threadId, title: null } : null,
    read, sharedSkills: path.join(ctx.checkout, ".agents", "skills"),
    orchestrators: Object.entries(ledger.claims).map(([n, c]) => ({ namespace: n, threadId: c.threadId, state: threadState(c.threadId) })),
    now: localStamp(now(), ctx.config.timezone), today: dayKey(now(), ctx.config.timezone), mm: ctx.mmPath,
  };
}

function status(ctx, ledger, roll) {
  const lanes = laneList(ledger, { open: true });
  const by = (s) => lanes.filter((l) => s.includes(l.state)).map((l) => `${l.name} [${l.ns}] ${l.title}${l.issue ? ` #${l.issue}` : ""}${l.pr ? ` PR #${l.pr}` : ""}`);
  const today = dayKey(now(), ctx.config.timezone);
  const done = laneList(ledger).filter((l) => l.endedAt && dayKey(l.endedAt, ctx.config.timezone) === today).map((l) => `${l.name}: ${l.state}`);
  const warnings = [...roll.warnings, ...reconcile(ctx, ledger)];
  const branch = ctx.config.defaultBranch || "main";
  const local = git(["rev-parse", branch], ctx.main).out;
  const remote = git(["rev-parse", `origin/${branch}`], ctx.main).out;
  if (local && remote && local !== remote) warnings.push(`local ${branch} differs from origin/${branch} (last fetched state)`);
  if (git(["status", "--porcelain", "--untracked-files=no"], ctx.main).out) warnings.push("the main checkout has uncommitted changes to tracked files");
  for (const [n, c] of Object.entries(ledger.claims)) {
    const st = threadState(c.threadId);
    if (st !== "live") warnings.push(`claim on ${n} is held by a thread that is ${st}`);
  }
  return {
    now: localStamp(now(), ctx.config.timezone),
    closedDays: roll.closed, finaliseSent: roll.finaliseSent, laneChanges: ledger.pendingChanges || [],
    waitingForUser: { approval: by(["held"]), answer: by(["waiting"]), blocked: by(["blocked"]) },
    running: by(["started", "running"]),
    completedToday: done,
    devlog: devlogSummaryLine(ctx, ledger),
    orchestrators: ledger.claims,
    warnings: [...new Set(warnings)],
  };
}

function main(argv) {
  const [cmd, sub, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") return out(HELP);
  if (cmd === "selftest") {
    const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, "selftest.mjs"), ...argv.slice(1)], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  const ctx = locate();
  const { pos, opt } = parse(cmd === "whoami" || cmd === "status" || cmd === "rollover" || cmd === "claim" || cmd === "release" ? argv.slice(1) : rest);

  if (cmd === "whoami") {
    const w = whoami(ctx, opt);
    if (opt.json) return out(w, true);
    return out([
      `namespace   ${w.namespace} (from ${w.source})`, `root        ${w.root}  →  ${w.rootAbs}`,
      `checkout    ${w.checkout}${w.isWorktree ? " (worktree)" : ""}`, `main        ${w.mainCheckout}`,
      `thread      ${w.thread ? `${w.thread.title} (${w.thread.id})` : "none"}`,
      `read first  ${w.read.join(", ") || "none found"}`, `skills      ${w.sharedSkills}`,
      `orchestrators ${w.orchestrators.map((o) => `${o.namespace}: ${o.threadId} (${o.state})`).join("; ") || "none"}`,
      `now         ${w.now}`, `mm          ${w.mm}`,
    ].join("\n"));
  }
  if (cmd === "ns" && sub === "list") return out(namespaces(ctx).reverse().map((n) => `${n.name}  →  ${n.root || "."}`).join("\n"));
  if (cmd === "ns") {
    if (sub !== "add" || !pos[0]) fail("usage: mm ns list | mm ns add <folder>");
    return out(nsAdd(ctx, pos[0]), true);
  }

  const unlock = lock(ctx.stateDir);
  try {
    const ledger = readLedger(ctx);
    const roll = rollover(ctx, ledger);
    syncLanes(ctx, ledger);
    writeLedger(ctx, ledger);
    let result;
    switch (cmd) {
      case "rollover": result = roll; break;
      case "status": result = status(ctx, ledger, roll); ledger.pendingChanges = []; break;
      case "claim": {
        const ns = pos[0] || whoami(ctx, {}).namespace;
        result = { namespace: ns, ...claim(ctx, ledger, ns, { threadId: opt.threadId || currentThreadId(), force: !!opt.force }) };
        break;
      }
      case "release": {
        const ns = pos[0] || whoami(ctx, {}).namespace;
        result = { namespace: ns, released: release(ctx, ledger, ns, opt.threadId || currentThreadId()) };
        break;
      }
      case "owner": result = owner(ctx, ledger, nsInfo(ctx, pos[0] || sub).name); break;
      case "lane":
        if (sub === "new") {
          result = laneNew(ctx, ledger, {
            name: pos[0], ns: opt.ns, title: opt.title, issue: num(opt.issue), class: opt.class, classReason: opt.classReason,
            needs: list(opt.needs), provider: opt.provider, reviewer: opt.reviewer, goalFile: opt.goalFile, why: opt.why,
            skipGitCheck: !!opt.skipGitCheck,
          });
        } else if (sub === "set") {
          result = laneSet(ctx, ledger, pos[0], { threadId: opt.threadId, taskId: opt.taskId, issue: num(opt.issue), pr: num(opt.pr) });
        } else if (sub === "update") {
          result = laneUpdate(ctx, ledger, pos[0], pos[1], { note: opt.note, why: opt.why, pr: num(opt.pr) });
        } else if (sub === "attach") {
          result = laneAttach(ctx, ledger, pos[0], opt.threadId || currentThreadId());
        } else if (sub === "cleanup") {
          result = laneCleanup(ctx, ledger, pos[0]);
        } else if (sub === "merge") {
          result = laneMerge(ctx, ledger, pos[0]);
        } else if (sub === "list") {
          const lanes = laneList(ledger, { open: !!opt.open });
          result = opt.json ? lanes : lanes.map((l) => `${l.name.padEnd(20)} ${l.state.padEnd(8)} ${l.ns}  ${l.title}${l.issue ? ` #${l.issue}` : ""}${l.pr ? ` PR #${l.pr}` : ""}`).join("\n") || "no lanes";
        } else fail("usage: mm lane new|set|update|list|attach|merge|cleanup");
        break;
      case "issue":
        if (sub !== "new") fail("usage: mm issue new <ns> \"<title>\" [--body-file <f>]");
        result = issueNew(ctx, pos[0], pos[1] || fail("title required"), opt.bodyFile ? fs.readFileSync(opt.bodyFile, "utf8") : "");
        break;
      case "task":
        if (sub === "new") result = taskNew(ctx, pos[0], pos[1] || fail("title required"), opt.bodyFile ? fs.readFileSync(opt.bodyFile, "utf8") : "");
        else if (sub === "list") result = taskList(ctx, pos[0]);
        else if (sub === "find") result = taskFind(ctx, pos.join(" ") || fail("give words to search for"));
        else if (sub === "start") result = taskStart(ctx, pos[0], { issue: num(opt.issue) });
        else fail("usage: mm task new|list|find|start");
        break;
      case "devlog":
        if (sub === "event") {
          const kind = pos[0];
          if (!NOTE_KINDS.includes(kind)) fail(`kind must be one of: ${NOTE_KINDS.join(", ")}. Lane states are recorded with mm lane update.`);
          const ns = opt.ns ? nsInfo(ctx, opt.ns).name : whoami(ctx, {}).namespace;
          const r = recordEvent(ctx, ledger, { kind, ns, what: pos[1] || fail("give the event text"), why: opt.why || undefined, links: list(opt.links) });
          result = { saved: r.day, dailyThread: r.thread };
        } else if (sub === "summary") {
          const d = day(ctx, pos[0]);
          setSummary(ctx, d, opt.file ? fs.readFileSync(opt.file, "utf8") : (pos[1] || fail("give --file or the text")));
          result = { day: d, summary: "saved", page: path.join(ctx.devlogDir, `${d}.html`) };
        } else if (sub === "render") {
          const d = day(ctx, pos[0]);
          renderPages(ctx, d);
          result = { page: path.join(ctx.devlogDir, `${d}.html`), index: path.join(ctx.devlogDir, "index.html") };
        } else if (sub === "thread") {
          ledger.dailyThreads[day(ctx, pos[0])] = pos[1] || fail("give the thread id");
          result = { day: day(ctx, pos[0]), thread: pos[1] };
        } else fail("usage: mm devlog event|summary|render|thread");
        break;
      case "preflight": result = { problems: gitPreflight(ctx) }; break;
      default: fail(`unknown command "${cmd}". Run mm help.`);
    }
    writeLedger(ctx, ledger);
    out(result, opt.json);
  } finally {
    unlock();
  }
}

try {
  main(process.argv.slice(2));
} catch (e) {
  if (e instanceof MmError) { console.error(`mm: ${e.message}`); process.exit(1); }
  throw e;
}
