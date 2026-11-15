#!/usr/bin/env node
// mm self-test: a throwaway git repository with a local "origin", fake t3 and gh commands, and a fake clock.
// Usage: mm selftest [--keep]   (--keep leaves the temporary folder for inspection)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clock, dayKey } from "./core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_CONFIG = path.join(HERE, "..", "..", "..", "..", ".mastermind", "config.json");
const keep = process.argv.includes("--keep");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-selftest-"));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); };
const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
};

const stateFile = path.join(tmp, "fake-state.json");
const fakeState = () => JSON.parse(fs.readFileSync(stateFile, "utf8"));
const saveFake = (s) => fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
saveFake({ threads: {}, prs: [], issues: [], next: 1 });

const fakeT3 = path.join(tmp, "fake-t3.mjs");
fs.writeFileSync(fakeT3, `#!/usr/bin/env node
import fs from "node:fs";
const file = process.env.FAKE_STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
const a = process.argv.slice(2);
const save = () => fs.writeFileSync(file, JSON.stringify(s, null, 2));
const stdin = () => { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } };
const flag = (n) => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
if (a[0] === "--version") { console.log("t3 fake"); process.exit(0); }
if (process.env.FAKE_T3_DOWN) { console.error("No running T3 Code server uses this home."); process.exit(1); }
if (a[0] === "thread" && a[1] === "start") {
  const id = "mcp:fake-" + s.next++;
  s.threads[id] = { title: flag("--title"), provider: flag("--provider"), model: flag("--model"), messages: [a[3] === "-" ? stdin() : a[3]], settled: false, archived: false };
  save(); console.log(JSON.stringify({ threadId: id })); process.exit(0);
}
const t = s.threads[a[2]];
if (!t) { console.error("Thread " + a[2] + " is no longer available."); process.exit(1); }
if (a[1] === "send") { t.messages.push(a[3] === "-" ? stdin() : a[3]); save(); console.log("{}"); process.exit(0); }
if (a[1] === "show") {
  const thread = { threadId: a[2], title: t.title, settled: t.settled, archived: t.archived, status: t.status || "idle", activeRunId: t.activeRunId || null,
    pendingRequestCount: t.pendingRequestCount || 0, latestRunId: t.latestRunId || "run:1", worktreePath: t.worktreePath || null };
  console.log(JSON.stringify({ thread, messages: t.last ? [{ role: "assistant", runId: thread.latestRunId, text: t.last }] : [] }));
  process.exit(0);
}
process.exit(2);
`);
const fakeGh = path.join(tmp, "fake-gh.mjs");
fs.writeFileSync(fakeGh, `#!/usr/bin/env node
import fs from "node:fs";
const file = process.env.FAKE_STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
const a = process.argv.slice(2);
const flag = (n) => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
const save = () => fs.writeFileSync(file, JSON.stringify(s, null, 2));
const [x, y] = a;
if (process.env.FAKE_GH_FAIL) { console.error("error connecting to api.github.com"); process.exit(1); }
if (x === "pr" && y === "list") { console.log(JSON.stringify(s.prs.filter((p) => p.state === "MERGED"))); process.exit(0); }
if (x === "pr" && y === "merge") { const p = s.prs.find((p) => String(p.number) === a[2]); p.state = "MERGED"; p.mergedAt = new Date().toISOString(); p.mergedBy = "mm"; save(); process.exit(0); }
if (x === "pr" && y === "view") { const p = s.prs.find((p) => String(p.number) === a[2]); if (!p) process.exit(1); console.log(JSON.stringify(p)); process.exit(0); }
if (x === "label" && y === "create") process.exit(0);
if (x === "issue" && y === "create") {
  const n = s.next++;
  s.issues.push({ number: n, title: flag("--title"), body: fs.readFileSync(flag("--body-file"), "utf8"), labels: [{ name: flag("--label") }], state: "OPEN", url: "https://github.com/o/r/issues/" + n });
  save(); console.log("https://github.com/o/r/issues/" + n); process.exit(0);
}
if (x === "issue" && y === "list") { console.log(JSON.stringify(s.issues)); process.exit(0); }
if (x === "issue" && y === "view") { const i = s.issues.find((i) => String(i.number) === a[2]); if (!i) process.exit(1); console.log(JSON.stringify(i)); process.exit(0); }
process.exit(2);
`);
fs.chmodSync(fakeT3, 0o755);
fs.chmodSync(fakeGh, 0o755);

const remote = path.join(tmp, "remote.git");
const main = path.join(tmp, "main");
const other = path.join(tmp, "other");
sh("git", ["init", "-q", "--bare", "-b", "main", remote]);
sh("git", ["clone", "-q", remote, main]);
for (const [k, v] of [["user.email", "t@example.com"], ["user.name", "t"]]) sh("git", ["config", k, v], main);
fs.mkdirSync(path.join(main, ".mastermind"));
fs.copyFileSync(REPO_CONFIG, path.join(main, ".mastermind", "config.json"));
fs.mkdirSync(path.join(main, "technophage"));
fs.writeFileSync(path.join(main, "technophage", "AGENTS.md"), "# technophage\n");
fs.writeFileSync(path.join(main, "AGENTS.md"), "# root\n");
fs.writeFileSync(path.join(main, ".gitignore"), ".mastermind/state/\n.mastermind/tasks/\n/devlog/\n");
sh("git", ["add", "-A"], main);
sh("git", ["commit", "-qm", "init"], main);
sh("git", ["branch", "-M", "main"], main);
sh("git", ["push", "-q", "-u", "origin", "main"], main);
const wt = path.join(tmp, "wt");
sh("git", ["worktree", "add", "-q", wt, "-b", "lane-branch"], main);

const env = (extra = {}) => ({ ...process.env, MM_T3: fakeT3, MM_GH: fakeGh, FAKE_STATE: stateFile, MM_THREAD_ID: "", T3CODE_THREAD_ID: "", ...extra });
function mm(args, { cwd = main, at, extra } = {}) {
  const r = spawnSync(process.execPath, [path.join(HERE, "mm.mjs"), ...args], { cwd, encoding: "utf8", env: env({ MM_NOW: at || "", ...extra }) });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* text output */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}
function mmAsync(args, { cwd = main, at } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, "mm.mjs"), ...args], { cwd, env: env({ MM_NOW: at || "" }) });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => resolve({ code, err }));
  });
}
const devlog = (f) => path.join(main, "devlog", f);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const lines = (day) => read(devlog(`data/${day}.jsonl`)).split("\n").filter(Boolean);
const threadsTitled = (s) => Object.entries(fakeState().threads).filter(([, t]) => t.title?.includes(s));
const goal = path.join(tmp, "goal.md");
fs.writeFileSync(goal, "Make the boss less punishing.\n");

// T1 namespace resolution
{
  let r = mm(["whoami", "--json"]);
  check("T1a whoami at the repository root gives the project namespace", r.json?.namespace === "dev.baddergames", r.out + r.err);
  r = mm(["whoami", "--json"], { cwd: path.join(main, "technophage") });
  check("T1b whoami inside technophage/ gives its namespace", r.json?.namespace === "dev.baddergames.technophage" && r.json.source === "current folder", r.out);
  const s = fakeState(); s.threads["mcp:orch"] = { title: "dev.baddergames.technophage", messages: [], settled: false, archived: false }; saveFake(s);
  r = mm(["whoami", "--json"], { extra: { MM_THREAD_ID: "mcp:orch" } });
  check("T1c whoami reads the namespace from the thread title", r.json?.namespace === "dev.baddergames.technophage" && r.json.source === "thread title", r.out);
  r = mm(["whoami", "--json", "--ns", "dev.baddergames"], { extra: { MM_THREAD_ID: "mcp:orch" } });
  check("T1d --ns takes precedence", r.json?.namespace === "dev.baddergames" && r.json.source === "--ns", r.out);
  r = mm(["whoami", "--json"], { cwd: wt });
  check("T1e from a worktree, the main checkout is found", r.json?.isWorktree === true && fs.realpathSync(r.json.mainCheckout) === fs.realpathSync(main), r.out);
  r = mm(["whoami", "--json", "--ns", "dev.nope"]);
  check("T1f an unknown namespace is refused", r.code === 1 && /unknown namespace/.test(r.err), r.err);
}

// T2 one Daily Update thread per day; later events are sent to it
{
  mm(["devlog", "event", "decision", "Use one devlog for all games"], { at: "2026-11-16T10:00:00Z" });
  mm(["devlog", "event", "finding", "Second event"], { at: "2026-11-16T11:00:00Z" });
  const t = threadsTitled("daily update · 2026-11-16");
  check("T2a two events on one day create exactly one Daily Update thread", t.length === 1, JSON.stringify(t.map(([id]) => id)));
  check("T2b the second event is sent to that thread", t[0]?.[1].messages.length === 2 && /Second event/.test(t[0][1].messages[1]), JSON.stringify(t[0]?.[1].messages));
  check("T2c the Daily Update thread uses the configured model", t[0]?.[1].model === "claude-opus-5-5" && t[0][1].provider === "claudeAgent", JSON.stringify(t[0]?.[1]));
}

// T3 work that spans midnight: Monday 23:30 to Tuesday 01:00
{
  let r = mm(["lane", "new", "boss", "--ns", "dev.baddergames.technophage", "--title", "Boss health fix", "--goal-file", goal, "--json"], { at: "2026-11-16T23:30:00Z" });
  check("T3a a lane starts and returns delegate_task values", r.code === 0 && r.json?.delegate_task?.isolation === "worktree" && r.json.delegate_task.target.model === "claude-opus-5-5", r.out + r.err);
  check("T3b the lane brief is written", /Lane brief: boss/.test(read(r.json?.briefPath || "")), r.json?.briefPath);
  mm(["lane", "update", "boss", "held", "--pr", "14"], { at: "2026-11-16T23:50:00Z" });
  r = mm(["rollover", "--json"], { at: "2026-11-17T00:05:00Z" });
  check("T3c after midnight, Monday is closed", r.json?.closed?.includes("2026-11-16"), r.out + r.err);
  const mon = threadsTitled("daily update · 2026-11-16")[0]?.[1];
  check("T3d Monday's thread gets the finalise message", mon?.messages.some((m) => m.includes("[devlog finalise · 2026-11-16]")), JSON.stringify(mon?.messages.slice(-1)));
  check("T3e Monday's page says the work was ongoing at end of day", /started 23:30 → ongoing at end of day \(waiting for your approval\)/.test(read(devlog("2026-11-16.html"))), "");
  mm(["lane", "update", "boss", "merged"], { at: "2026-11-17T01:00:00Z" });
  const tue = read(devlog("2026-11-17.html"));
  check("T3f Tuesday's page shows ongoing → completed with the start time", /ongoing since Mon 11-16 23:30 → completed 01:00 \(merged\)/.test(tue), "");
  check("T3g Tuesday gets its own Daily Update thread", threadsTitled("daily update · 2026-11-17").length === 1, "");
  check("T3h Monday's final page did not change after Tuesday's merge", /ongoing at end of day/.test(read(devlog("2026-11-16.html"))), "");
}

// T4 work started and finished on the same day
{
  mm(["lane", "new", "quick", "--ns", "dev.baddergames", "--title", "Hub title text", "--goal-file", goal], { at: "2026-11-18T14:10:00Z" });
  mm(["lane", "update", "quick", "merged"], { at: "2026-11-18T16:45:00Z" });
  check("T4 a same-day lane shows its start and end time", /14:10–16:45 · completed \(merged\)/.test(read(devlog("2026-11-18.html"))), "");
}

// T5 a week away: closed days, empty days, and merged pull requests found by the sweep
{
  const s = fakeState();
  s.prs.push({ number: 7, title: "Tune the swarm", url: "https://github.com/o/r/pull/7", state: "MERGED", mergedAt: "2026-11-20T12:00:00Z", headRefName: "technophage/7-swarm" });
  saveFake(s);
  const r = mm(["status", "--json"], { at: "2026-11-25T09:00:00Z" });
  check("T5a the first command after a week closes the old days", r.json?.closedDays?.includes("2026-11-18") && r.json.closedDays.includes("2026-11-20"), r.out + r.err);
  check("T5b days with no events get no page", !fs.existsSync(devlog("2026-11-19.html")) && !fs.existsSync(devlog("2026-11-21.html")), "");
  check("T5c a pull request merged on a day with no events is recorded on that day", /#7 Tune the swarm/.test(read(devlog("2026-11-20.html"))), "");
  check("T5d a day without a Daily Update thread is marked summary missing", JSON.parse(read(devlog("data/2026-11-20.json")) || "{}").summaryMissing === true, read(devlog("data/2026-11-20.json")));
  check("T5f a swept pull request is filed under the namespace of its branch", lines("2026-11-20").some((l) => JSON.parse(l).key === "pr:7" && JSON.parse(l).ns === "dev.baddergames.technophage"), lines("2026-11-20").join("\n"));
  check("T5e the index links every day, newest first", (() => { const i = read(devlog("index.html")); return i.indexOf("2026-11-20.html") < i.indexOf("2026-11-16.html") && i.includes("2026-11-18.html"); })(), "");
}

// T6 rollover is idempotent
{
  const before = lines("2026-11-20").length;
  const msgs = threadsTitled("daily update · 2026-11-18")[0]?.[1].messages.length;
  const r = mm(["rollover", "--json"], { at: "2026-11-25T09:30:00Z" });
  check("T6a a second rollover closes nothing", r.json?.closed?.length === 0, r.out);
  check("T6b no duplicate sweep entries", lines("2026-11-20").length === before, `${before} vs ${lines("2026-11-20").length}`);
  check("T6c no second finalise message", threadsTitled("daily update · 2026-11-18")[0]?.[1].messages.length === msgs, "");
}

// T7 parallel writers
{
  const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => mmAsync(["devlog", "event", "note", `parallel ${i}`], { at: "2026-11-25T10:00:00Z" })));
  check("T7a eight parallel events all succeed", runs.every((r) => r.code === 0), runs.map((r) => r.err).join(""));
  const ls = lines("2026-11-25");
  check("T7b all eight are saved as valid lines", ls.length === 8 && ls.every((l) => JSON.parse(l).kind === "note"), String(ls.length));
  check("T7c exactly one Daily Update thread for that day", threadsTitled("daily update · 2026-11-25").length === 1, "");
}

// T8 lane start rules
{
  let r = mm(["lane", "new", "art1", "--ns", "dev.baddergames.technophage", "--title", "Boss sprite", "--goal-file", goal, "--needs", "image-generation", "--provider", "claude"], { at: "2026-11-25T11:00:00Z" });
  check("T8a image work on Claude is refused", r.code === 1 && /cannot do: image-generation/.test(r.err), r.err);
  r = mm(["lane", "new", "art2", "--ns", "dev.baddergames.technophage", "--title", "Boss sprite", "--goal-file", goal, "--needs", "image-generation", "--json"], { at: "2026-11-25T11:00:00Z" });
  check("T8b image work goes to Codex automatically", r.json?.delegate_task?.target?.providerInstanceId === "codex" && r.json.delegate_task.target.model === "gpt-6.1-sol", r.out + r.err);
  fs.appendFileSync(path.join(main, "AGENTS.md"), "change\n");
  r = mm(["lane", "new", "dirty", "--ns", "dev.baddergames", "--title", "x", "--goal-file", goal], { at: "2026-11-25T11:00:00Z" });
  check("T8c a lane is refused while the main checkout has uncommitted changes", r.code === 1 && /uncommitted changes/.test(r.err), r.err);
  sh("git", ["checkout", "--", "AGENTS.md"], main);
  sh("git", ["clone", "-q", remote, other]);
  for (const [k, v] of [["user.email", "t@example.com"], ["user.name", "t"]]) sh("git", ["config", k, v], other);
  fs.writeFileSync(path.join(other, "README.md"), "x\n");
  sh("git", ["add", "-A"], other); sh("git", ["commit", "-qm", "remote change"], other); sh("git", ["push", "-q"], other);
  r = mm(["lane", "new", "behind", "--ns", "dev.baddergames", "--title", "x", "--goal-file", goal], { at: "2026-11-25T11:00:00Z" });
  check("T8d a lane is refused while main is behind origin", r.code === 1 && /1 behind/.test(r.err), r.err);
  sh("git", ["pull", "-q", "--ff-only"], main);
  r = mm(["lane", "new", "boss", "--ns", "dev.baddergames", "--title", "x", "--goal-file", goal], { at: "2026-11-25T11:00:00Z" });
  check("T8e a lane name is never reused", r.code === 1 && /already exists/.test(r.err), r.err);
}

// T9 orchestrator claims
{
  const s = fakeState();
  s.threads["mcp:A"] = { title: "dev.baddergames", messages: [], settled: false, archived: false };
  s.threads["mcp:B"] = { title: "dev.baddergames", messages: [], settled: false, archived: false };
  saveFake(s);
  let r = mm(["claim", "dev.baddergames"], { extra: { MM_THREAD_ID: "mcp:A" }, at: "2026-11-25T12:00:00Z" });
  check("T9a a thread claims a namespace", r.code === 0, r.err);
  r = mm(["claim", "dev.baddergames"], { extra: { MM_THREAD_ID: "mcp:B" }, at: "2026-11-25T12:00:00Z" });
  check("T9b a second live orchestrator is refused", r.code === 1 && /claimed by thread mcp:A/.test(r.err), r.err);
  const s2 = fakeState(); s2.threads["mcp:A"].settled = true; saveFake(s2);
  r = mm(["claim", "dev.baddergames"], { extra: { MM_THREAD_ID: "mcp:B" }, at: "2026-11-25T12:00:00Z" });
  check("T9c the claim moves once the old thread is settled", r.code === 0, r.err);
}

// T10 tasks and issues
{
  let r = mm(["task", "new", "dev.baddergames.technophage", "Boss health tuning", "--json"], { at: "2026-11-25T13:00:00Z" });
  check("T10a a task file is created", r.code === 0 && fs.existsSync(r.json?.file || ""), r.out + r.err);
  r = mm(["task", "find", "boss", "health", "--json"], { at: "2026-11-25T13:00:00Z" });
  check("T10b the task is found by its words", r.json?.tasks?.length === 1, r.out);
  r = mm(["task", "start", "dev.baddergames.technophage/boss-health-tuning", "--json"], { at: "2026-11-25T13:00:00Z" });
  const issue = fakeState().issues.find((i) => i.title === "Boss health tuning");
  check("T10c starting it creates an issue with the namespace label", issue && issue.labels[0].name === "ns:technophage", JSON.stringify(issue));
  check("T10d the task file keeps only a link to the issue", /Moved to issue #\d+/.test(read(path.join(main, ".mastermind/tasks/dev.baddergames.technophage/boss-health-tuning.md"))), "");
}

// T11 a merged pull request closes its lane
{
  mm(["lane", "new", "net", "--ns", "dev.baddergames", "--title", "Lobby fix", "--goal-file", goal, "--json"], { at: "2026-11-25T14:00:00Z" });
  mm(["lane", "set", "net", "--pr", "9"], { at: "2026-11-25T14:05:00Z" });
  const s = fakeState(); s.prs.push({ number: 9, state: "MERGED", mergedAt: "2026-11-25T15:00:00Z", closedAt: null }); saveFake(s);
  const r = mm(["lane", "list", "--json"], { at: "2026-11-25T15:30:00Z" });
  const before = r.json?.find((l) => l.name === "net")?.state;
  mm(["status"], { at: "2026-11-25T15:30:00Z" });
  const after = mm(["lane", "list", "--json"], { at: "2026-11-25T15:31:00Z" }).json?.find((l) => l.name === "net");
  check("T11 status marks a lane merged when its pull request is merged", before === "started" && after?.state === "merged" && after.endedAt === "2026-11-25T15:00:00Z", JSON.stringify(after));
}

// T12 clock changes
{
  check("T12a 00:30 local on the night the clocks go back is that day", dayKey("2026-10-24T23:30:00Z", "Europe/London") === "2026-10-25" && clock("2026-10-24T23:30:00Z", "Europe/London") === "00:30", "");
  check("T12b 23:30 UTC after the change is still the same day", dayKey("2026-10-25T23:30:00Z", "Europe/London") === "2026-10-25", "");
  check("T12c summer time: 23:30 UTC is 00:30 the next day", dayKey("2027-06-01T23:30:00Z", "Europe/London") === "2027-06-02", "");
}

// T13 events are saved even when T3 is not reachable
{
  const r = mm(["devlog", "event", "note", "offline note", "--json"], { at: "2026-11-25T16:00:00Z", extra: { MM_T3: path.join(tmp, "no-such-t3") } });
  check("T13 with no t3, the event is still saved", r.code === 0 && lines("2026-11-25").some((l) => l.includes("offline note")), r.out + r.err);
}

// T14 summaries
{
  const f = path.join(tmp, "summary.md");
  fs.writeFileSync(f, "Boss fix **finished** after midnight.\n\n- waits on nothing\n");
  const r = mm(["devlog", "summary", "2026-11-17", "--file", f], { at: "2026-11-25T17:00:00Z" });
  const page = read(devlog("2026-11-17.html"));
  check("T14 a summary is saved and shown on the day's page and the index", r.code === 0 && page.includes("<strong>finished</strong>") && page.includes("badge final\">final<") && read(devlog("index.html")).includes("<strong>finished</strong>"), r.err);
}

// T15 a T3 server that is down is not a missing thread
{
  const s = fakeState();
  s.threads["mcp:C"] = { title: "dev.baddergames", messages: [], settled: false, archived: false };
  saveFake(s);
  let r = mm(["claim", "dev.baddergames"], { extra: { MM_THREAD_ID: "mcp:C", FAKE_T3_DOWN: "1" }, at: "2026-11-25T18:00:00Z" });
  check("T15a with the T3 server down, another thread cannot take a claim", r.code === 1 && /not reachable/.test(r.err), r.out + r.err);
  mm(["devlog", "event", "note", "server-down day"], { at: "2026-11-27T10:00:00Z" });
  r = mm(["rollover", "--json"], { at: "2026-11-28T09:00:00Z", extra: { FAKE_T3_DOWN: "1" } });
  const meta = JSON.parse(read(devlog("data/2026-11-27.json")) || "{}");
  check("T15b with the T3 server down, the day closes but the summary is not given up", r.json?.closed?.includes("2026-11-27") && !meta.summaryMissing && !meta.finaliseSentAt, JSON.stringify(meta));
  r = mm(["rollover", "--json"], { at: "2026-11-28T09:30:00Z" });
  check("T15c once T3 is back, the finalise message is sent", r.json?.finaliseSent?.includes("2026-11-27"), r.out + r.err);
}

// T16 a failed GitHub sweep leaves the days open
{
  mm(["devlog", "event", "note", "sweep day"], { at: "2026-11-29T10:00:00Z" });
  const s = fakeState(); s.prs.push({ number: 30, title: "Late sweep", url: "https://github.com/o/r/pull/30", state: "MERGED", mergedAt: "2026-11-29T12:00:00Z", headRefName: "baddergames/30-x" }); saveFake(s);
  let r = mm(["rollover", "--json"], { at: "2026-11-30T09:00:00Z", extra: { FAKE_GH_FAIL: "1" } });
  check("T16a when the sweep fails, nothing is closed and a warning is given", r.json?.closed?.length === 0 && r.json.warnings.some((w) => /stay open/.test(w)) && !JSON.parse(read(devlog("data/2026-11-29.json")) || "{}").final, r.out);
  r = mm(["rollover", "--json"], { at: "2026-11-30T09:10:00Z" });
  check("T16b the next run closes the day and records the pull request", r.json?.closed?.includes("2026-11-29") && lines("2026-11-29").some((l) => l.includes('"pr:30"')), r.out);
}

// T17 options
{
  const s = fakeState(); s.threads["mcp:D"] = { title: "x", messages: [], settled: false, archived: false }; saveFake(s);
  let r = mm(["claim", "--force", "dev.baddergames.technophage", "--json"], { extra: { MM_THREAD_ID: "mcp:D" }, at: "2026-11-30T10:00:00Z" });
  check("T17a --force before the namespace claims that namespace", r.json?.namespace === "dev.baddergames.technophage", r.out + r.err);
  r = mm(["lane", "list", "--bogus"], { at: "2026-11-30T10:00:00Z" });
  check("T17b an unknown option is refused", r.code === 1 && /unknown option --bogus/.test(r.err), r.err);
  r = mm(["lane", "set", "net", "--pr"], { at: "2026-11-30T10:00:00Z" });
  check("T17c an option without its value is refused", r.code === 1 && /--pr needs a value/.test(r.err), r.err);
}

// T18 day pages link to the next day once it exists
check("T18 Monday's page links forward to Tuesday", read(devlog("2026-11-16.html")).includes('href="2026-11-17.html"'), "");

// T19 lane states only through mm lane
{
  const r = mm(["devlog", "event", "started", "Ghost work"], { at: "2026-11-30T10:00:00Z" });
  check("T19 devlog event refuses lane states", r.code === 1 && /mm lane update/.test(r.err), r.err);
}

// T20 a merge recorded after its day closed
{
  mm(["lane", "new", "late", "--ns", "dev.baddergames", "--title", "Late merge", "--goal-file", goal], { at: "2026-12-01T18:00:00Z" });
  mm(["lane", "set", "late", "--pr", "21"], { at: "2026-12-01T18:05:00Z" });
  const s = fakeState(); s.prs.push({ number: 21, state: "MERGED", mergedAt: "2026-12-01T23:58:00Z", closedAt: null }); saveFake(s);
  mm(["status"], { at: "2026-12-02T00:30:00Z" });
  const page = read(devlog("2026-12-01.html"));
  check("T20a the closed day's page shows the real merge time", /18:00–23:58 · completed \(merged\)/.test(page) && /late event was added/.test(page), "");
  const t = threadsTitled("daily update · 2026-12-01")[0]?.[1];
  check("T20b that day's Daily Update thread is told about the late event", t?.messages.some((m) => /recorded late/.test(m)), JSON.stringify(t?.messages.slice(-1)));
}

// T21 nested sub-project folders resolve to the deepest root
{
  const { nsFromPath } = await import("./core.mjs");
  const ctx = { checkout: "/r", config: { namespaces: { "dev.b": ".", "dev.b.games": "games", "dev.b.ab": "games/ab" } } };
  check("T21 a folder inside a nested root resolves to the nested namespace", nsFromPath(ctx, "/r/games/ab/src") === "dev.b.ab" && nsFromPath(ctx, "/r/games/x") === "dev.b.games", "");
}

// T22 lanes record themselves, and mm reads their reports
{
  const at = "2026-12-02T10:00:00Z";
  mm(["lane", "new", "sync", "--ns", "dev.baddergames.technophage", "--title", "Sync probe", "--goal-file", goal], { at });
  let s = fakeState(); s.threads["mcp:lane-sync"] = { title: "dev.baddergames.technophage · sync", messages: [], settled: false, archived: false, status: "running", activeRunId: "run:1", latestRunId: "run:1" }; saveFake(s);
  let r = mm(["lane", "attach", "sync", "--json"], { cwd: wt, at, extra: { MM_THREAD_ID: "mcp:lane-sync" } });
  check("T22a a lane attaches its own thread from its worktree", r.json?.threadId === "mcp:lane-sync", r.out + r.err);
  const lane = () => mm(["lane", "list", "--json"], { at }).json.find((l) => l.name === "sync");
  check("T22b a running lane thread is recorded as running", lane().state === "running", JSON.stringify(lane()));
  s = fakeState(); Object.assign(s.threads["mcp:lane-sync"], { status: "completed", activeRunId: null, latestRunId: "run:2", last: "HELD: https://github.com/o/r/pull/31 — reviews done, checks green, waiting for approval\n\ndetails" }); saveFake(s);
  mm(["lane", "list"], { at: "2026-12-02T10:10:00Z" });
  mm(["lane", "list"], { at: "2026-12-02T10:11:00Z" });
  const held = lane();
  check("T22c a HELD report is recorded with its pull request, once", held.state === "held" && held.pr === 31 && lines("2026-12-02").filter((l) => JSON.parse(l).kind === "held" && JSON.parse(l).lane === "sync").length === 1, JSON.stringify(held));
  s = fakeState(); Object.assign(s.threads["mcp:lane-sync"], { status: "waiting", latestRunId: "run:3", pendingRequestCount: 1 }); saveFake(s);
  check("T22d a question from the lane is recorded as waiting", (mm(["lane", "list"], { at: "2026-12-02T10:20:00Z" }), lane().state === "waiting"), JSON.stringify(lane()));
  s = fakeState(); Object.assign(s.threads["mcp:lane-sync"], { status: "completed", latestRunId: "run:4", pendingRequestCount: 0, last: "Done, I think." }); saveFake(s);
  mm(["lane", "list"], { at: "2026-12-02T10:30:00Z" });
  check("T22e a final message without a status line is flagged", lane().history.at(-1).note?.includes("without a status line"), JSON.stringify(lane().history.at(-1)));
  s = fakeState(); Object.assign(s.threads["mcp:lane-sync"], { latestRunId: "run:5", last: "HELD: PR https://github.com/o/r/pull/31 ready" }); saveFake(s);
  mm(["lane", "list"], { at: "2026-12-02T10:40:00Z" });
}

// T23 merging only under the rule
{
  const at = "2026-12-02T11:00:00Z";
  const s = fakeState();
  s.prs.push({ number: 31, state: "OPEN", mergeStateStatus: "CLEAN", headRefName: "technophage/sync", url: "https://github.com/o/r/pull/31", statusCheckRollup: [{ name: "checks", status: "COMPLETED", conclusion: "FAILURE" }] });
  saveFake(s);
  let r = mm(["lane", "merge", "sync"], { at });
  check("T23a a failing check blocks the merge", r.code === 1 && /checks not passed: checks: FAILURE/.test(r.err) && fakeState().prs.find((p) => p.number === 31).state === "OPEN", r.err);
  let s2 = fakeState(); s2.prs.find((p) => p.number === 31).statusCheckRollup = []; saveFake(s2);
  r = mm(["lane", "merge", "sync"], { at });
  check("T23b a pull request with no checks is not merged", r.code === 1 && /no checks ran/.test(r.err), r.err);
  s2 = fakeState(); Object.assign(s2.prs.find((p) => p.number === 31), { statusCheckRollup: [{ name: "checks", status: "COMPLETED", conclusion: "SUCCESS" }], mergeStateStatus: "BEHIND" }); saveFake(s2);
  r = mm(["lane", "merge", "sync"], { at });
  check("T23c a pull request behind main is not merged", r.code === 1 && /BEHIND/.test(r.err), r.err);
  s2 = fakeState(); s2.prs.find((p) => p.number === 31).mergeStateStatus = "CLEAN"; saveFake(s2);
  r = mm(["lane", "merge", "sync", "--json"], { at });
  check("T23d a clean, passing, held pull request is merged and the lane closed", r.code === 0 && fakeState().prs.find((p) => p.number === 31).mergedBy === "mm" && mm(["lane", "list", "--json"], { at }).json.find((l) => l.name === "sync").state === "merged", r.out + r.err);
  r = mm(["lane", "merge", "net"], { at });
  check("T23e a lane that is not held cannot be merged", r.code === 1 && /not held/.test(r.err), r.err);
}

// T24 new sub-project
{
  const r = mm(["ns", "add", "technowizard"], { cwd: wt });
  const cfg = JSON.parse(read(path.join(wt, ".mastermind", "config.json")));
  const agents = read(path.join(wt, "technowizard", "AGENTS.md"));
  check("T24a ns add registers the namespace and writes its agent files", r.code === 0 && cfg.namespaces["dev.baddergames.technowizard"] === "technowizard" && /Namespace: `dev.baddergames.technowizard`/.test(agents) && read(path.join(wt, "technowizard", "CLAUDE.md")) === "@AGENTS.md\n", r.out + r.err);
  const w = mm(["whoami", "--json"], { cwd: path.join(wt, "technowizard") });
  check("T24b the new folder resolves to its namespace", w.json?.namespace === "dev.baddergames.technowizard", w.out + w.err);
  const again = mm(["ns", "add", "technowizard"], { cwd: wt });
  check("T24c an existing namespace is refused", again.code === 1 && /already exists/.test(again.err), again.err);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `\n      ${String(r.detail).slice(0, 600).replace(/\n/g, "\n      ")}`}`);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, tmp: keep ? tmp : undefined }));
if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
