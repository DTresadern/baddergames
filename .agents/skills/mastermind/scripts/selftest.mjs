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
if (a[1] === "send" && t.sendFails) { console.error("send refused"); process.exit(1); }
if (a[1] === "send") { t.messages.push(a[3] === "-" ? stdin() : a[3]); save(); console.log("{}"); process.exit(0); }
if (a[1] === "show") {
  const thread = { threadId: a[2], title: t.title, settled: t.settled, archived: t.archived, status: t.status || "idle", activeRunId: t.activeRunId || null,
    pendingRequestCount: t.pendingRequestCount || 0, latestRunId: t.latestRunId || "run:1", runCount: t.runCount, worktreePath: t.worktreePath || null };
  console.log(JSON.stringify({ thread, messages: t.last ? [{ role: "assistant", runId: t.lastRunId || thread.latestRunId, text: t.last }] : [] }));
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
fs.writeFileSync(path.join(main, ".mastermind", "config.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(REPO_CONFIG, "utf8")), namespaces: { "dev.baddergames": ".", "dev.baddergames.technophage": "technophage" }, laneWorktreeRoot: tmp }, null, 2) + "\n");
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
  // The thread starts with the day's first mm command (the carried-over message), so the two events are messages 2 and 3.
  check("T2b the second event is sent to that thread", t[0]?.[1].messages.length === 3 && /Second event/.test(t[0][1].messages[2]) && /Use one devlog/.test(t[0][1].messages[1]), JSON.stringify(t[0]?.[1].messages));
  check("T2d the thread starts with the carried-over message, not an event", /\[devlog day start · 2026-11-16\] No work was carried over from earlier days\./.test(t[0]?.[1].messages[0]) && !/\[devlog event/.test(t[0][1].messages[0]), t[0]?.[1].messages[0].slice(-300));
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
  check("T22e a turn without a status line is treated as working, not flagged", lane().state === "running" && lane().quietSince && !/quiet for/.test(lane().history.at(-1).note || ""), JSON.stringify(lane().history.at(-1)));
  s = fakeState(); Object.assign(s.threads["mcp:lane-sync"], { latestRunId: "run:5", last: "HELD: https://github.com/o/r/pull/31 ready" }); saveFake(s);
  mm(["lane", "list"], { at: "2026-12-02T10:40:00Z" });
  s = fakeState(); Object.assign(s.threads["mcp:lane-sync"], { status: "running", activeRunId: "run:6", latestRunId: "run:6" }); saveFake(s);
  mm(["lane", "list"], { at: "2026-12-02T10:45:00Z" });
  s = fakeState(); Object.assign(s.threads["mcp:lane-sync"], { status: "interrupted", activeRunId: null, latestRunId: "run:6", lastRunId: "run:5" }); saveFake(s);
  mm(["lane", "list"], { at: "2026-12-02T10:50:00Z" });
  check("T22f a run interrupted after a HELD report does not fall back to held", lane().state === "blocked" && /interrupted/.test(lane().history.at(-1).note), JSON.stringify(lane().history.slice(-2)));
  s = fakeState(); Object.assign(s.threads["mcp:lane-sync"], { status: "completed", latestRunId: "run:7", lastRunId: "run:6", last: "HELD: https://github.com/o/r/pull/31 ready" }); saveFake(s);
  mm(["lane", "list"], { at: "2026-12-02T10:52:00Z" });
  check("T22g a report from an earlier run is not taken as the latest run's report", lane().state === "running" && lane().quietSince, JSON.stringify(lane()));
  let st = mm(["status", "--json"], { at: "2026-12-02T10:53:00Z" });
  check("T22h changes found by other commands wait for mm status, then clear", st.json?.laneChanges?.some((c) => /sync: blocked/.test(c.note)) && mm(["status", "--json"], { at: "2026-12-02T10:54:00Z" }).json.laneChanges.length === 0, JSON.stringify(st.json?.laneChanges));
  const heldEvents = () => lines("2026-12-02").filter((l) => JSON.parse(l).kind === "held" && JSON.parse(l).lane === "sync").length;
  const before = heldEvents();
  const dailyMsgs = () => threadsTitled("daily update · 2026-12-02")[0]?.[1].messages.length;
  const msgsBefore = dailyMsgs();
  s = fakeState(); Object.assign(s.threads["mcp:lane-sync"], { latestRunId: "run:8", lastRunId: null, last: "HELD: https://github.com/o/r/pull/31 ready" }); saveFake(s);
  mm(["task", "find"], { at: "2026-12-02T10:55:00Z" });
  mm(["task", "find"], { at: "2026-12-02T10:56:00Z" });
  check("T22i a command that fails after a sync does not repeat the sync's events", heldEvents() === before + 1 && dailyMsgs() === msgsBefore + 1 && lane().state === "held", `${before}→${heldEvents()}, messages ${msgsBefore}→${dailyMsgs()}`);
  mm(["lane", "new", "words", "--ns", "dev.baddergames", "--title", "Report words", "--goal-file", goal], { at: "2026-12-02T11:00:00Z" });
  mm(["lane", "set", "words", "--thread-id", "mcp:lane-words"], { at: "2026-12-02T11:00:00Z" });
  const word = (n, text) => { const x = fakeState(); x.threads["mcp:lane-words"] = { title: "w", messages: [], settled: false, archived: false, status: "completed", latestRunId: `run:${n}`, last: text }; saveFake(x); mm(["lane", "list"], { at: "2026-12-02T11:0" + n + ":00Z" }); return mm(["lane", "list", "--json"], { at: "2026-12-02T11:0" + n + ":30Z" }).json.find((l) => l.name === "words"); };
  check("T22j BLOCKED is recorded as blocked", word(1, "BLOCKED: needs a stronger model — the netcode is subtle").state === "blocked", "");
  const req = word(2, "REQUEST-LANE: add a lobby API — the menu needs it");
  check("T22k REQUEST-LANE records the request and waits", req.state === "waiting" && lines("2026-12-02").some((l) => JSON.parse(l).kind === "request-lane" && /lobby API/.test(JSON.parse(l).what)), JSON.stringify(req.history.at(-1)));
  check("T22l CLOSED closes the lane", word(3, "CLOSED: already done upstream").state === "closed", "");
  mm(["lane", "new", "bg", "--ns", "dev.baddergames", "--title", "Background wait", "--goal-file", goal], { at: "2026-12-02T11:30:00Z" });
  mm(["lane", "set", "bg", "--thread-id", "mcp:lane-bg"], { at: "2026-12-02T11:30:00Z" });
  const bgEvents = () => lines("2026-12-02").filter((l) => JSON.parse(l).lane === "bg").length;
  const bgState = (n, fields, at) => { const x = fakeState(); x.threads["mcp:lane-bg"] = { title: "bg", messages: [], settled: false, archived: false, ...fields }; saveFake(x); mm(["lane", "list"], { at }); return mm(["lane", "list", "--json"], { at }).json.find((l) => l.name === "bg"); };
  bgState(1, { status: "running", activeRunId: "run:1", latestRunId: "run:1" }, "2026-12-02T11:31:00Z");
  const afterRun = bgEvents();
  const w = bgState(1, { status: "completed", latestRunId: "run:1", last: "WORKING: waiting for the browser re-check" }, "2026-12-02T11:32:00Z");
  check("T22m WORKING keeps the lane running and records nothing new", w.state === "running" && bgEvents() === afterRun && !mm(["status", "--json"], { at: "2026-12-02T11:32:30Z" }).json.laneChanges.some((c) => c.note.startsWith("bg:")), JSON.stringify(w.history));
  const r2 = bgState(2, { status: "running", activeRunId: "run:2", latestRunId: "run:2" }, "2026-12-02T11:33:00Z");
  check("T22n a new run of a lane that never stopped adds no event", r2.state === "running" && bgEvents() === afterRun, `${afterRun} → ${bgEvents()}`);
  const q1 = bgState(2, { status: "completed", latestRunId: "run:2", last: "Sixth review running; browser run still pending." }, "2026-12-02T12:00:00Z");
  const q2 = bgState(2, { status: "completed", latestRunId: "run:2", last: "Sixth review running; browser run still pending." }, "2026-12-02T12:14:00Z");
  check("T22o a turn without a status line counts as running for 15 minutes", q1.state === "running" && q2.state === "running" && bgEvents() === afterRun, JSON.stringify(q2.history.at(-1)));
  const q3 = bgState(2, { status: "completed", latestRunId: "run:2", last: "Sixth review running; browser run still pending." }, "2026-12-02T12:15:30Z");
  check("T22p after 15 quiet minutes it is reported as waiting", q3.state === "waiting" && /quiet for 15 minutes/.test(q3.history.at(-1).note), JSON.stringify(q3.history.at(-1)));
  const q4 = bgState(3, { status: "running", activeRunId: "run:3", latestRunId: "run:3" }, "2026-12-02T12:16:00Z");
  const q5 = bgState(3, { status: "completed", latestRunId: "run:3", last: "Seventh review running." }, "2026-12-02T12:20:00Z");
  check("T22q a new run resets the quiet period", q4.state === "running" && q5.state === "running", JSON.stringify(q5.history.at(-1)));
  mm(["lane", "update", "bg", "held", "--pr", "77"], { at: "2026-12-02T12:21:00Z" });
  const q6 = bgState(4, { status: "completed", latestRunId: "run:4", last: "Review of the requested change running." }, "2026-12-02T12:22:00Z");
  const merge = mm(["lane", "merge", "bg"], { at: "2026-12-02T12:22:30Z" });
  check("T22r a held lane that starts new work is running at once and cannot be merged", q6.state === "running" && merge.code === 1 && /is running, not held/.test(merge.err), merge.err + JSON.stringify(q6.history.at(-1)));
  const st2 = mm(["status", "--json"], { at: "2026-12-02T12:23:00Z" });
  check("T22s mm status lists quiet lanes with a re-check time", st2.json?.quietLanes?.some((q) => q.lane === "bg" && q.recheckAt === "2026-12-02T12:38:00.000Z"), JSON.stringify(st2.json?.quietLanes));
  bgState(4, { status: "completed", latestRunId: "run:4", last: "x" }, "2026-12-02T12:40:00Z");
  mm(["lane", "update", "bg", "held", "--pr", "77", "--note", "set by hand"], { at: "2026-12-02T12:41:00Z" });
  const q7 = bgState(4, { status: "completed", latestRunId: "run:4", last: "x" }, "2026-12-02T12:50:00Z");
  check("T22t after the waiting report, a state set by hand is not undone", q7.state === "held", JSON.stringify(q7.history.slice(-2)));
  bgState(5, { status: "completed", latestRunId: "run:5", last: "**HELD:** bold report the pattern misses" }, "2026-12-02T13:00:00Z");
  mm(["lane", "update", "bg", "held", "--pr", "77", "--note", "read from the thread"], { at: "2026-12-02T13:02:00Z" });
  const q8 = bgState(5, { status: "completed", latestRunId: "run:5", last: "**HELD:** bold report the pattern misses" }, "2026-12-02T13:20:00Z");
  check("T22u a state set by hand during the quiet period is not undone when it ends", q8.state === "held" && !q8.quietSince, JSON.stringify(q8.history.slice(-2)));
}

// T23 merging only under the rule
{
  const at = "2026-12-02T11:20:00Z";
  const s = fakeState();
  s.prs.push({ number: 31, state: "OPEN", mergeStateStatus: "CLEAN", headRefName: "technophage/other", headRefOid: "abc1234", baseRefName: "main", url: "https://github.com/o/r/pull/31", statusCheckRollup: [{ name: "checks", status: "COMPLETED", conclusion: "SUCCESS" }] });
  saveFake(s);
  let r = mm(["lane", "merge", "sync"], { at });
  check("T23f a pull request from another branch is never merged", r.code === 1 && /not the lane's branch technophage\/sync/.test(r.err), r.err);
  let s1 = fakeState(); Object.assign(s1.prs.find((p) => p.number === 31), { headRefName: "technophage/sync", statusCheckRollup: [{ name: "a", conclusion: "SKIPPED" }, { name: "b", conclusion: "NEUTRAL" }] }); saveFake(s1);
  r = mm(["lane", "merge", "sync"], { at });
  check("T23g only skipped checks is not enough", r.code === 1 && /no check ran and passed/.test(r.err), r.err);
  s1 = fakeState(); s1.prs.find((p) => p.number === 31).statusCheckRollup = [{ name: "checks", status: "COMPLETED", conclusion: "FAILURE" }]; saveFake(s1);
  r = mm(["lane", "merge", "sync"], { at });
  check("T23a a failing check blocks the merge", r.code === 1 && /checks not passed: checks: FAILURE/.test(r.err) && fakeState().prs.find((p) => p.number === 31).state === "OPEN", r.err);
  let s2 = fakeState(); s2.prs.find((p) => p.number === 31).statusCheckRollup = []; saveFake(s2);
  r = mm(["lane", "merge", "sync"], { at });
  check("T23b a pull request with no checks is not merged", r.code === 1 && /no check ran and passed/.test(r.err), r.err);
  s2 = fakeState(); Object.assign(s2.prs.find((p) => p.number === 31), { statusCheckRollup: [{ name: "checks", status: "COMPLETED", conclusion: "SUCCESS" }], mergeStateStatus: "BEHIND" }); saveFake(s2);
  r = mm(["lane", "merge", "sync"], { at });
  check("T23c a pull request behind main is not merged", r.code === 1 && /BEHIND/.test(r.err), r.err);
  s2 = fakeState(); s2.prs.find((p) => p.number === 31).mergeStateStatus = "CLEAN"; saveFake(s2);
  r = mm(["lane", "merge", "sync", "--json"], { at });
  check("T23d a clean, passing, held pull request is merged and the lane closed", r.code === 0 && fakeState().prs.find((p) => p.number === 31).mergedBy === "mm" && mm(["lane", "list", "--json"], { at }).json.find((l) => l.name === "sync").state === "merged", r.out + r.err);
  r = mm(["lane", "merge", "net"], { at });
  check("T23e a lane that is not held cannot be merged", r.code === 1 && /not held/.test(r.err), r.err);
}

// T25 merge with a real worktree: refusals, then cleanup that deletes only what main contains
{
  const at = "2026-12-03T10:00:00Z";
  mm(["lane", "new", "real", "--ns", "dev.baddergames", "--title", "Real worktree", "--goal-file", goal], { at });
  const wtReal = path.join(tmp, "wt-real");
  sh("git", ["worktree", "add", "-q", "-b", "t3/real-slug", wtReal, "main"], main);
  sh("git", ["branch", "-m", "baddergames/real"], wtReal);
  fs.writeFileSync(path.join(wtReal, "real.txt"), "one\n");
  sh("git", ["add", "real.txt"], wtReal); sh("git", ["commit", "-qm", "real one"], wtReal); sh("git", ["push", "-q", "-u", "origin", "baddergames/real"], wtReal);
  const head = () => sh("git", ["rev-parse", "HEAD"], wtReal);
  const s = fakeState();
  s.threads["mcp:lane-real"] = { title: "real", messages: [], settled: false, archived: false, status: "completed", latestRunId: "run:1", worktreePath: wtReal, last: "HELD: https://github.com/o/r/pull/40 ready" };
  s.prs.push({ number: 40, state: "OPEN", mergeStateStatus: "CLEAN", headRefName: "baddergames/real", headRefOid: head(), baseRefName: "main", url: "https://github.com/o/r/pull/40", statusCheckRollup: [{ name: "checks", conclusion: "SUCCESS" }] });
  saveFake(s);
  mm(["lane", "set", "real", "--thread-id", "mcp:lane-real"], { at });
  fs.writeFileSync(path.join(wtReal, "real.txt"), "uncommitted\n");
  let r = mm(["lane", "merge", "real"], { at });
  check("T25a uncommitted changes in the lane's worktree block the merge", r.code === 1 && /uncommitted changes/.test(r.err), r.err);
  sh("git", ["commit", "-qam", "real two"], wtReal);
  r = mm(["lane", "merge", "real"], { at });
  check("T25b commits that are not in the pull request block the merge", r.code === 1 && /not in the pull request/.test(r.err), r.err);
  sh("git", ["push", "-q"], wtReal);
  const s2 = fakeState(); s2.prs.find((p) => p.number === 40).headRefOid = head(); saveFake(s2);
  sh("git", ["push", "-q", "origin", "baddergames/real:main"], wtReal);
  r = mm(["lane", "merge", "real", "--json"], { at });
  const c = r.json?.cleanup || {};
  check("T25c the merge goes through and every cleanup step reports what happened", r.code === 0 && c.worktree?.startsWith("removed") && c.remoteBranch === "deleted baddergames/real" && c.mainCheckout === "updated" && c.localBranches?.[0] === "baddergames/real: deleted", r.out + r.err);
  check("T25d the worktree, the local branch and the remote branch are gone", !fs.existsSync(wtReal) && spawnSync("git", ["rev-parse", "--verify", "-q", "refs/heads/baddergames/real"], { cwd: main }).status !== 0 && !sh("git", ["ls-remote", "--heads", "origin", "baddergames/real"], main), "");
  r = mm(["lane", "cleanup", "real", "--json"], { at });
  check("T25e cleanup after a finished merge is safe to repeat", r.code === 0 && r.json.cleanup.remoteBranch === "baddergames/real: already gone" && r.json.cleanup.worktree === "none found", r.out + r.err);
  r = mm(["lane", "cleanup", "art2"], { at });
  check("T25f cleanup refuses a lane that is not merged or closed", r.code === 1 && /only merged or closed lanes/.test(r.err), r.err);
  const wtStop = path.join(tmp, "wt-stop");
  mm(["lane", "new", "stop", "--ns", "dev.baddergames", "--title", "Stopped merge", "--goal-file", goal], { at });
  sh("git", ["worktree", "add", "-q", "-b", "baddergames/stop", wtStop, "main"], main);
  fs.writeFileSync(path.join(wtStop, "stop.txt"), "x\n");
  sh("git", ["add", "stop.txt"], wtStop); sh("git", ["commit", "-qm", "stop"], wtStop); sh("git", ["push", "-q", "-u", "origin", "baddergames/stop"], wtStop);
  sh("git", ["push", "-q", "origin", "baddergames/stop:main"], wtStop);
  const s3 = fakeState(); s3.threads["mcp:lane-stop"] = { title: "stop", messages: [], settled: false, archived: false, status: "completed", latestRunId: "run:1", worktreePath: wtStop }; saveFake(s3);
  mm(["lane", "set", "stop", "--thread-id", "mcp:lane-stop"], { at });
  mm(["lane", "update", "stop", "merged", "--note", "merged, cleanup stopped"], { at });
  r = mm(["lane", "cleanup", "stop", "--json"], { at });
  check("T25g cleanup finishes a merge that was stopped partway", r.code === 0 && r.json.cleanup.remoteBranch === "deleted baddergames/stop" && r.json.cleanup.worktree.startsWith("removed") && !fs.existsSync(wtStop), r.out + r.err);
  const wtClosed = path.join(tmp, "wt-closed");
  mm(["lane", "new", "dropped", "--ns", "dev.baddergames", "--title", "Dropped work", "--goal-file", goal], { at });
  sh("git", ["worktree", "add", "-q", "-b", "baddergames/dropped", wtClosed, "main"], main);
  fs.writeFileSync(path.join(wtClosed, "d.txt"), "x\n");
  sh("git", ["add", "d.txt"], wtClosed); sh("git", ["commit", "-qm", "dropped"], wtClosed); sh("git", ["push", "-q", "-u", "origin", "baddergames/dropped"], wtClosed);
  const s4 = fakeState(); s4.threads["mcp:lane-dropped"] = { title: "d", messages: [], settled: false, archived: false, status: "completed", latestRunId: "run:1", worktreePath: wtClosed }; saveFake(s4);
  mm(["lane", "set", "dropped", "--thread-id", "mcp:lane-dropped"], { at });
  mm(["lane", "update", "dropped", "closed", "--note", "user dropped it"], { at });
  r = mm(["lane", "cleanup", "dropped", "--json"], { at });
  check("T25h cleanup of an unmerged lane keeps its worktree and branches", r.code === 0 && /kept .*not in main/.test(r.json.cleanup.worktree) && /kept, it has commits/.test(r.json.cleanup.remoteBranch) && fs.existsSync(wtClosed), r.out + r.err);
  sh("git", ["push", "-q", "origin", "baddergames/dropped:main"], wtClosed);
  fs.writeFileSync(path.join(wtClosed, ".env"), "SECRET=1\n");
  fs.appendFileSync(path.join(wtClosed, ".gitignore"), ".env\n"); sh("git", ["commit", "-qam", "ignore env"], wtClosed); sh("git", ["push", "-q"], wtClosed); sh("git", ["push", "-q", "origin", "baddergames/dropped:main"], wtClosed);
  fs.writeFileSync(path.join(main, "my-notes.txt"), "untracked work in the main checkout\n");
  fs.mkdirSync(path.join(main, "devlog"), { recursive: true });
  fs.writeFileSync(path.join(main, "devlog", "keep-me.txt"), "ignored file in the main checkout\n");
  r = mm(["lane", "cleanup", "dropped", "--json"], { at });
  check("T25i a lane worktree with ignored files is removed, and the files are listed", r.code === 0 && /^removed .*ignored files went with it: \.env/.test(r.json.cleanup.worktree) && !fs.existsSync(wtClosed) && r.json.cleanup.localBranches[0] === "baddergames/dropped: deleted", r.out + r.err);
  check("T25j untracked and ignored files in the main checkout are untouched", read(path.join(main, "my-notes.txt")).startsWith("untracked") && read(path.join(main, "devlog", "keep-me.txt")).startsWith("ignored") && fs.existsSync(path.join(main, ".mastermind", "state", "ledger.json")), "");
  const guard = (name, worktreePath) => {
    mm(["lane", "new", name, "--ns", "dev.baddergames", "--title", name, "--goal-file", goal], { at });
    const x = fakeState(); x.threads[`mcp:lane-${name}`] = { title: name, messages: [], settled: false, archived: false, status: "completed", latestRunId: "run:1", worktreePath }; saveFake(x);
    mm(["lane", "set", name, "--thread-id", `mcp:lane-${name}`], { at });
    mm(["lane", "update", name, "closed", "--note", "guard test"], { at });
    return mm(["lane", "cleanup", name, "--json"], { at });
  };
  r = guard("guardmain", main);
  check("T25k the main checkout is never removed, even if a thread points at it", r.code === 0 && /kept .*it is the main checkout/.test(r.json.cleanup.worktree) && fs.existsSync(path.join(main, "my-notes.txt")) && fs.existsSync(path.join(main, ".git")), r.out + r.err);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mm-outside-"));
  sh("git", ["worktree", "add", "-q", "-b", "baddergames/outside", outside, "main"], main);
  r = guard("guardout", outside);
  check("T25l a worktree outside the lane worktree folder is kept", r.code === 0 && /not inside the lane worktree folder/.test(r.json.cleanup.worktree) && fs.existsSync(outside), r.out + r.err);
  sh("git", ["worktree", "remove", "--force", outside], main); fs.rmSync(outside, { recursive: true, force: true });
  const wtNew = path.join(tmp, "wt-newfile");
  sh("git", ["worktree", "add", "-q", "-b", "baddergames/guardnew", wtNew, "main"], main);
  fs.writeFileSync(path.join(wtNew, "draft.txt"), "not committed\n");
  r = guard("guardnew", wtNew);
  check("T25m a lane worktree with a new, not ignored file is kept", r.code === 0 && /new files \(draft\.txt\)/.test(r.json.cleanup.worktree) && fs.existsSync(path.join(wtNew, "draft.txt")), r.out + r.err);
  const nightly = path.join(tmp, "wt-nightly");
  sh("git", ["worktree", "add", "-q", "-b", "t3/nightly-like", nightly, "main"], main);
  r = guard("guardother", nightly);
  check("T25n a worktree on another branch (another thread's) is kept", r.code === 0 && /on branch t3\/nightly-like, not the lane's branch/.test(r.json.cleanup.worktree) && fs.existsSync(nightly), r.out + r.err);
  r = guard("guardrel", "wt-nightly");
  check("T25o a relative worktree path is refused", r.code === 0 && /(not absolute|none found)/.test(r.json.cleanup.worktree) && fs.existsSync(nightly), r.out + r.err);
  mm(["lane", "new", "ign", "--ns", "dev.baddergames", "--title", "Ignored overwrite", "--goal-file", goal], { at });
  const wtIgn = path.join(tmp, "wt-ign");
  sh("git", ["worktree", "add", "-q", "-b", "baddergames/ign", wtIgn, "main"], main);
  fs.mkdirSync(path.join(wtIgn, "devlog"), { recursive: true });
  fs.writeFileSync(path.join(wtIgn, "devlog", "keep-me.txt"), "tracked by the lane\n");
  sh("git", ["add", "-f", "devlog/keep-me.txt"], wtIgn); sh("git", ["commit", "-qm", "force-add"], wtIgn); sh("git", ["push", "-q", "-u", "origin", "baddergames/ign"], wtIgn);
  sh("git", ["push", "-q", "origin", "baddergames/ign:main"], wtIgn);
  const xi = fakeState(); xi.threads["mcp:lane-ign"] = { title: "ign", messages: [], settled: false, archived: false, status: "completed", latestRunId: "run:1", worktreePath: wtIgn }; saveFake(xi);
  mm(["lane", "set", "ign", "--thread-id", "mcp:lane-ign"], { at });
  mm(["lane", "update", "ign", "merged", "--note", "merged"], { at });
  r = mm(["lane", "cleanup", "ign", "--json"], { at });
  check("T25p updating main never overwrites an ignored file in the main checkout", r.code === 0 && /not updated/.test(r.json.cleanup.mainCheckout) && read(path.join(main, "devlog", "keep-me.txt")).startsWith("ignored file"), r.out + r.err);
  r = mm(["task", "start", "../../AGENTS"], { at });
  check("T25q a task id that leaves the tasks folder is refused", r.code === 1 && /task id must be/.test(r.err) && read(path.join(main, "AGENTS.md")) === "# root\n", r.err);
  r = mm(["ns", "add", "newgame"], { cwd: main });
  check("T25r ns add refuses to run in the main checkout", r.code === 1 && /not the main checkout/.test(r.err) && !fs.existsSync(path.join(main, "newgame")), r.err);
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

// T26 a WORKING lane that stays idle gets reminders, then is reported; lanes send notices without ending their turn
{
  const at = (hm) => `2026-12-04T${hm}Z`;
  const thread = (id, fields) => { const x = fakeState(); x.threads[id] = { title: id, messages: x.threads[id]?.messages || [], settled: false, archived: false, ...fields }; saveFake(x); };
  const sent = (id) => fakeState().threads[id].messages;
  const lane = (name, t) => (mm(["lane", "list"], { at: at(t) }), mm(["lane", "list", "--json"], { at: at(t) }).json.find((l) => l.name === name));
  const idle = (n, text = "WORKING: benchmark running, about 10 minutes") => ({ status: "completed", activeRunId: null, latestRunId: `run:${n}`, runCount: n, last: text });
  const busy = (n) => ({ status: "running", activeRunId: `run:${n}`, latestRunId: `run:${n}`, runCount: n });
  for (const name of ["wk", "wk2", "wk3"]) {
    mm(["lane", "new", name, "--ns", "dev.baddergames", "--title", `Working ${name}`, "--goal-file", goal, "--skip-git-check"], { at: at("09:00:00") });
    mm(["lane", "set", name, "--thread-id", `mcp:lane-${name}`], { at: at("09:00:00") });
  }
  thread("mcp:lane-wk", idle(1));
  let l = lane("wk", "10:00:00");
  const st = mm(["status", "--json"], { at: at("10:00:30") });
  check("T26a WORKING sets a quiet period and the lane is listed for a re-check", l.state === "running" && l.quietSince && st.json?.quietLanes?.some((q) => q.lane === "wk" && q.recheckAt === "2026-12-04T10:16:00.000Z"), JSON.stringify(st.json?.quietLanes));
  lane("wk", "10:14:00");
  check("T26b no reminder before the quiet period ends", sent("mcp:lane-wk").length === 0, JSON.stringify(sent("mcp:lane-wk")));
  l = lane("wk", "10:15:30");
  const st2 = mm(["status", "--json"], { at: at("10:15:40") });
  check("T26c after the quiet period the idle WORKING lane gets one reminder and stays running", sent("mcp:lane-wk").length === 1 && /mm reminder \(1 of 3\).*WORKING/.test(sent("mcp:lane-wk")[0]) && l.state === "running" && st2.json.laneChanges.some((c) => /wk: .*reminder 1 of 3/.test(c.note)), JSON.stringify(st2.json.laneChanges));
  const st3 = mm(["status", "--json"], { at: at("10:16:00") });
  check("T26c2 a lane just sent a reminder stays listed for a re-check", st3.json?.quietLanes?.some((q) => q.lane === "wk" && q.reminders === 1 && q.recheckAt === "2026-12-04T10:31:30.000Z"), JSON.stringify(st3.json?.quietLanes));
  lane("wk", "10:40:00");
  check("T26d no second reminder while no new run has started", sent("mcp:lane-wk").length === 1, String(sent("mcp:lane-wk").length));
  let t = 2;
  for (const [runAt, idleAt, remindAt] of [["10:41:00", "10:42:00", "10:57:30"], ["11:00:00", "11:01:00", "11:16:30"]]) {
    thread("mcp:lane-wk", busy(t)); lane("wk", runAt);
    thread("mcp:lane-wk", idle(t)); lane("wk", idleAt); lane("wk", remindAt); t++;
  }
  check("T26e a lane that answers each reminder with WORKING gets reminders 2 and 3", sent("mcp:lane-wk").length === 3 && /\(3 of 3\)/.test(sent("mcp:lane-wk")[2]), JSON.stringify(sent("mcp:lane-wk").map((m) => m.slice(0, 20))));
  thread("mcp:lane-wk", busy(t)); lane("wk", "11:20:00");
  thread("mcp:lane-wk", idle(t)); lane("wk", "11:21:00");
  l = lane("wk", "11:36:30");
  check("T26f after 3 reminders with nothing else run, the lane is reported as waiting", l.state === "waiting" && /after 3 reminders/.test(l.history.at(-1).note) && sent("mcp:lane-wk").length === 3, JSON.stringify(l.history.at(-1)));
  thread("mcp:lane-wk2", idle(1)); lane("wk2", "12:00:00"); lane("wk2", "12:15:30");
  thread("mcp:lane-wk2", idle(3)); lane("wk2", "12:20:00"); lane("wk2", "12:35:30");
  check("T26g a run the reminder did not start resets the count", sent("mcp:lane-wk2").length === 2 && /\(1 of 3\)/.test(sent("mcp:lane-wk2")[1]), JSON.stringify(sent("mcp:lane-wk2").map((m) => m.slice(0, 20))));
  thread("mcp:lane-wk2", idle(4, "HELD: https://github.com/o/r/pull/90 ready")); l = lane("wk2", "12:40:00");
  check("T26h any other status line clears the reminders", l.state === "held" && !l.reminders && !l.quietSince, JSON.stringify(l));
  thread("mcp:lane-wk3", { ...idle(1), sendFails: true }); lane("wk3", "13:00:00"); l = lane("wk3", "13:15:30");
  check("T26i if the reminder cannot be sent, the lane is reported as waiting", l.state === "waiting" && /could not send it a reminder/.test(l.history.at(-1).note), JSON.stringify(l.history.at(-1)));
  for (const name of ["wk4", "wk5", "wk6"]) {
    mm(["lane", "new", name, "--ns", "dev.baddergames.technophage", "--title", `Working ${name}`, "--goal-file", goal, "--skip-git-check"], { at: at("13:00:00"), extra: { MM_THREAD_ID: "mcp:orch-start" } });
    mm(["lane", "set", name, "--thread-id", `mcp:lane-${name}`], { at: at("13:00:00") });
  }
  thread("mcp:lane-wk4", idle(1)); lane("wk4", "13:01:00");
  mm(["lane", "update", "wk4", "held", "--pr", "91", "--note", "set by hand"], { at: at("13:02:00") });
  l = lane("wk4", "13:16:30");
  check("T26l a WORKING lane set to held by hand gets no reminder and stays held", l.state === "held" && sent("mcp:lane-wk4").length === 0, JSON.stringify(l.history.slice(-2)));
  thread("mcp:lane-wk5", { ...idle(1), archived: true }); lane("wk5", "13:01:00"); l = lane("wk5", "13:16:30");
  check("T26m an archived WORKING lane gets no reminder and is reported as waiting", l.state === "waiting" && /archived/.test(l.history.at(-1).note) && sent("mcp:lane-wk5").length === 0, JSON.stringify(l.history.at(-1)));
  thread("mcp:lane-wk6", { ...idle(1), runCount: undefined }); lane("wk6", "13:01:00");
  for (const [n, a, b, c] of [[2, "13:17:00", "13:18:00", "13:33:30"], [3, "13:34:00", "13:35:00", "13:50:30"], [4, "13:51:00", "13:52:00", "14:07:30"]]) {
    if (n === 2) lane("wk6", "13:16:30");
    thread("mcp:lane-wk6", { ...busy(n), runCount: undefined }); lane("wk6", a);
    thread("mcp:lane-wk6", { ...idle(n), runCount: undefined }); lane("wk6", b); lane("wk6", c);
  }
  l = mm(["lane", "list", "--json"], { at: at("14:08:00") }).json.find((x) => x.name === "wk6");
  check("T26n without a run count, the waiting note does not claim nothing else ran", l.state === "waiting" && /after 3 reminders/.test(l.history.at(-1).note) && !/nothing else run/.test(l.history.at(-1).note), JSON.stringify(l.history.at(-1)));
  thread("mcp:orch-start", { status: "completed" });
  for (let o; (o = mm(["owner", "dev.baddergames.technophage", "--json"], { at: at("14:09:00") }).json);) { const x = fakeState(); x.threads[o.threadId].settled = true; saveFake(x); }
  const startBefore = sent("mcp:orch-start").length;
  const r0 = mm(["lane", "notify", "wk4", "fallback notice", "--json"], { cwd: wt, at: at("14:10:00"), extra: { MM_THREAD_ID: "mcp:lane-wk4" } });
  check("T26o with no live orchestrator for the namespace, notify goes to the thread that started the lane", r0.json?.sentTo === "mcp:orch-start" && sent("mcp:orch-start").length === startBefore + 1 && /fallback notice/.test(sent("mcp:orch-start").at(-1)), r0.out + r0.err);
  thread("mcp:hub", { status: "completed" });
  mm(["claim", "--force", "dev.baddergames"], { extra: { MM_THREAD_ID: "mcp:hub" }, at: at("13:20:00") });
  const hubBefore = sent("mcp:hub").length;
  let r = mm(["lane", "notify", "wk", "benchmarks finished at 13:20, machine is free", "--json"], { cwd: wt, at: at("13:21:00"), extra: { MM_THREAD_ID: "mcp:lane-wk" } });
  check("T26j lane notify sends the text to the namespace's orchestrator", r.code === 0 && r.json?.sentTo === "mcp:hub" && sent("mcp:hub").length === hubBefore + 1 && /Notice from lane wk.*\n\nbenchmarks finished at 13:20, machine is free/s.test(sent("mcp:hub").at(-1)), r.out + r.err);
  r = mm(["lane", "notify", "wk", "spoofed"], { cwd: wt, at: at("13:22:00"), extra: { MM_THREAD_ID: "mcp:lane-wk2" } });
  check("T26k another thread cannot send a lane's notices", r.code === 1 && /only that thread sends its notices/.test(r.err) && sent("mcp:hub").length === hubBefore + 1, r.err);
}

// T27 finalise after a summary: only when events were recorded after it
{
  const T = (d, hm) => `${d}T${hm}Z`;
  const sumFile = (text) => { const f = path.join(tmp, "t27-summary.md"); fs.writeFileSync(f, text); return f; };
  const fins = (day) => (threadsTitled(`daily update · ${day}`)[0]?.[1].messages || []).filter((m) => m.includes(`[devlog finalise · ${day}]`));
  const metaOf = (day) => JSON.parse(read(devlog(`data/${day}.json`)) || "{}");
  const A = "2027-03-01", B = "2027-03-02", C = "2027-03-03", D = "2027-03-04", F = "2027-03-05";
  // Every mm command closes earlier days, so the days below close (and may get a finalise message) as the clock moves on.
  const s = fakeState();
  s.prs.push({ number: 90, title: "Early merge", url: "https://github.com/o/r/pull/90", state: "MERGED", mergedAt: T(B, "11:00:00"), headRefName: "baddergames/90-early" });
  saveFake(s);
  // A: event after the summary
  mm(["devlog", "event", "note", "A early"], { at: T(A, "10:00:00") });
  mm(["devlog", "summary", A, "--file", sumFile("A first summary\n")], { at: T(A, "12:00:00") });
  mm(["devlog", "event", "note", "A late"], { at: T(A, "15:00:00") });
  // B: a pull request merged before the summary, found by the closing sweep
  mm(["devlog", "event", "note", "B early"], { at: T(B, "09:00:00") });
  mm(["devlog", "summary", B, "--file", sumFile("B summary\n")], { at: T(B, "20:00:00") });
  // C: summary after every event, nothing swept
  mm(["devlog", "event", "note", "C only"], { at: T(C, "09:00:00") });
  mm(["devlog", "summary", C, "--file", sumFile("C summary\n")], { at: T(C, "18:00:00") });
  // D: no summary
  mm(["devlog", "event", "note", "D only"], { at: T(D, "09:00:00") });
  // F: old data, no recordedAt anywhere
  fs.mkdirSync(devlog("data"), { recursive: true });
  fs.writeFileSync(devlog(`data/${F}.jsonl`), JSON.stringify({ kind: "note", ns: "dev.baddergames", what: "F old event", at: T(F, "09:00:00") }) + "\n");
  fs.writeFileSync(devlog(`data/${F}.json`), JSON.stringify({ final: true, finalisedAt: T(F, "23:59:00"), summary: "F summary", summaryAt: T(F, "12:00:00") }));
  // G: an event recorded after the day closed (already sent to the thread one by one) does not count.
  // H: an event recorded after the summary, but the day has no Daily Update thread.
  const G = "2027-02-27", H = "2027-02-28";
  fs.writeFileSync(devlog(`data/${G}.jsonl`), JSON.stringify({ kind: "note", ns: "dev.baddergames", what: "G late", at: T(G, "09:00:00"), recordedAt: T("2027-03-01", "08:00:00") }) + "\n");
  fs.writeFileSync(devlog(`data/${G}.json`), JSON.stringify({ final: true, finalisedAt: T("2027-03-01", "00:10:00"), summary: "G summary", summaryAt: T(G, "12:00:00") }));
  fs.writeFileSync(devlog(`data/${H}.jsonl`), JSON.stringify({ kind: "note", ns: "dev.baddergames", what: "H late", at: T(H, "15:00:00"), recordedAt: T(H, "15:00:00") }) + "\n");
  fs.writeFileSync(devlog(`data/${H}.json`), JSON.stringify({ final: true, finalisedAt: T("2027-03-01", "00:10:00"), summary: "H summary", summaryAt: T(H, "12:00:00") }));
  const r = mm(["rollover", "--json"], { at: "2027-03-06T09:00:00Z" });
  check("T27a a summary followed by a later event gets one finalise message", fins(A).length === 1 && !!metaOf(A).finaliseSentAt, JSON.stringify(fins(A).length) + JSON.stringify(metaOf(A)));
  const swept = lines(B).map((l) => JSON.parse(l)).find((e) => e.key === "pr:90");
  check("T27b a pull request merged before the summary but swept at close is recorded after it", !!swept && swept.at < metaOf(B).summaryAt && swept.recordedAt > metaOf(B).summaryAt && fins(B).length === 1 && !!metaOf(B).finaliseSentAt, JSON.stringify(swept) + JSON.stringify(metaOf(B)));
  const mc = metaOf(C);
  check("T27c a summary written after every event gets no finalise message", fins(C).length === 0 && !mc.finaliseSentAt && !mc.summaryMissing && !mc.finaliseSkipped && !!mc.final, JSON.stringify(mc));
  check("T27d a day with no summary gets one finalise message", fins(D).length === 1 && !!metaOf(D).finaliseSentAt, JSON.stringify(fins(D).length));
  const r2 = mm(["rollover", "--json"], { at: "2027-03-06T10:00:00Z" });
  check("T27e a second rollover sends no second finalise message", r2.json?.finaliseSent?.length === 0 && fins(A).length === 1 && fins(B).length === 1 && fins(D).length === 1, r2.out);
  const mf = metaOf(F);
  check("T27f a closed day whose events have no recordedAt gets no finalise message", !mf.finaliseSentAt && !mf.summaryMissing && !mf.finaliseSkipped, JSON.stringify(mf));
  const mg = metaOf(G), mh = metaOf(H);
  check("T27h an event recorded after the day closed does not trigger a finalise message", !mg.finaliseSentAt && !mg.finaliseSkipped && mg.finaliseNotNeeded === true && !r.json?.finaliseSent?.includes(G), JSON.stringify(mg));
  check("T27i a day with a summary and no thread is marked finalise skipped, not summary missing", mh.finaliseSkipped === true && !mh.summaryMissing && !mh.finaliseSentAt, JSON.stringify(mh));
  check("T27j a checked day with nothing new is not checked again", metaOf(C).finaliseNotNeeded === true && mf.finaliseNotNeeded === true, JSON.stringify(metaOf(C)));
  mm(["devlog", "summary", A, "--file", sumFile("A rewritten **final** summary\n")], { at: "2027-03-06T11:00:00Z" });
  check("T27g a new summary replaces the old one and the page shows it", metaOf(A).summary.startsWith("A rewritten") && read(devlog(`${A}.html`)).includes("<strong>final</strong>") && !read(devlog(`${A}.html`)).includes("A first summary"), metaOf(A).summary);
}

// T28 the day check hook, which threads are ready to settle, and the thread started at a day change.
// Runs in its own state, devlog folder and fake T3, so earlier tests' threads do not appear in the lists.
{
  const s28 = path.join(tmp, "t28-fake.json");
  const E28 = { MM_STATE_DIR: path.join(tmp, "t28-state"), MM_DEVLOG_DIR: path.join(tmp, "t28-devlog"), FAKE_STATE: s28 };
  fs.writeFileSync(s28, JSON.stringify({ threads: {}, prs: [], issues: [], next: 1 }));
  const fk = () => JSON.parse(fs.readFileSync(s28, "utf8"));
  const sv = (x) => fs.writeFileSync(s28, JSON.stringify(x, null, 2));
  const m = (args, o = {}) => mm(args, { ...o, extra: { ...E28, ...o.extra } });
  const T = (day, hm = "09:00:00") => `2027-06-${day}T${hm}Z`;
  const hub = { MM_THREAD_ID: "mcp:hub28" };
  const dc = (at, extra = {}) => m(["daycheck"], { at, extra: { ...hub, ...extra } });
  const dcFile = path.join(E28.MM_STATE_DIR, "daycheck.json");
  const last = () => JSON.parse(read(dcFile) || "{}").lastChecked;
  const hook = (r) => JSON.parse(r.out).hookSpecificOutput;
  const quiet = (r) => r.code === 0 && r.out === "" && r.err === "";
  const dthread = (day) => Object.entries(fk().threads).filter(([, t]) => t.title?.includes(`daily update · 2027-06-${day}`));
  const tune = (day, fields) => { const x = fk(); Object.assign(x.threads[dthread(day)[0][0]], fields); sv(x); };
  const ledger28 = () => JSON.parse(read(path.join(E28.MM_STATE_DIR, "ledger.json")));
  const days28 = (list) => list.map((t) => t.day.slice(8));
  const mmBin = path.join(HERE, "mm");
  const x28 = fk();
  for (const id of ["mcp:hub28", "mcp:other28"]) x28.threads[id] = { title: "dev.baddergames", messages: [], settled: false, archived: false };
  sv(x28);

  // a. nothing is said outside the hub orchestrator's thread
  let r = m(["daycheck"], { at: T("01", "08:00:00") });
  check("T28a1 with no thread id, the day check prints nothing and exits 0", quiet(r), r.out + r.err);
  r = dc(T("01", "08:00:00"));
  check("T28a2 with a thread id but no claim, it prints nothing and writes nothing", quiet(r) && !fs.existsSync(dcFile), r.out + r.err);
  m(["claim", "dev.baddergames"], { at: T("01", "08:00:00"), extra: hub });
  r = dc(T("01", "08:30:00"), { MM_THREAD_ID: "mcp:other28" });
  check("T28a3 in another thread, it prints nothing and writes nothing", quiet(r) && !fs.existsSync(dcFile), r.out + r.err);
  const first = dthread("01")[0]?.[1].messages[0] || "";
  check("T28a4 the first mm command of the day started that day's thread: no work carried over", dthread("01").length === 1 && /\[devlog day start · 2027-06-01\] No work was carried over from earlier days\./.test(first) && /Events of 2027-06-01 follow in this thread as messages\./.test(first), first.slice(-300));

  // b. the first run ever, in the hub thread (matched by either thread id variable)
  r = dc(T("01"), { T3CODE_THREAD_ID: "mcp:hub28", MM_THREAD_ID: "mcp:other28" });
  const o = r.code === 0 && r.err === "" ? hook(r) : {};
  check("T28b the first run in the hub thread tells it to run mm rollover", o.hookEventName === "UserPromptSubmit" && o.additionalContext.includes(`${mmBin} rollover`) && /last checked never/.test(o.additionalContext) && o.additionalContext.includes("2027-06-01") && /settleThreads/.test(o.additionalContext), r.out + r.err);
  check("T28b2 with nothing left to do, the date is marked as checked", last() === "2027-06-01", read(dcFile));
  m(["devlog", "event", "note", "first note"], { at: T("01", "10:00:00"), extra: hub });

  // c. the same day: no output, and no t3 or gh call
  const marker = path.join(tmp, "t28-marker.txt");
  const spy = path.join(tmp, "t28-spy.sh");
  fs.writeFileSync(spy, `#!/bin/sh\necho "$0 $@" >> "${marker}"\nexit 1\n`);
  fs.chmodSync(spy, 0o755);
  r = dc(T("01", "15:00:00"), { MM_T3: spy, MM_GH: spy });
  check("T28c on a day already checked it prints nothing and calls neither t3 nor gh", quiet(r) && !fs.existsSync(marker), r.out + r.err + read(marker));

  // d. a day change, and a gap of several days
  r = dc(T("02"));
  check("T28d1 the next day prints a message naming the new date and the last check", r.code === 0 && hook(r).additionalContext.includes("The day has changed to 2027-06-02 (last checked 2027-06-01)"), r.out + r.err);
  r = dc(T("05"));
  check("T28d2 after several days the message names the new date", r.code === 0 && hook(r).additionalContext.includes("The day has changed to 2027-06-05 (last checked 2027-06-01)"), r.out + r.err);
  check("T28d3 the last checked date does not advance while a past day is still open", last() === "2027-06-01", read(dcFile));

  // e. the date advances only when nothing is left
  r = dc(T("05"), { MM_T3: spy, MM_GH: spy });
  check("T28e0 a day check that has work to look at does call t3 (so the test in c proves something)", fs.existsSync(marker), r.out + r.err);
  const old = dthread("01")[0][0];
  const roll = m(["rollover", "--json"], { at: T("05", "09:30:00"), extra: hub });
  check("T28e1 mm rollover closes the old day and lists its thread as ready", roll.json?.closed?.includes("2027-06-01") && roll.json.settleThreads.some((t) => t.day === "2027-06-01" && t.threadId === old), roll.out + roll.err);
  r = dc(T("05", "10:00:00"));
  check("T28e2 a live finished thread keeps the date unchanged and is named in the message", last() === "2027-06-01" && hook(r).additionalContext.includes(`2027-06-01 (${old})`), r.out + r.err + read(dcFile));
  { const x = fk(); x.threads[old].settled = true; sv(x); }
  r = dc(T("05", "10:10:00"));
  check("T28e3 once it is settled and every day is closed, the date advances", last() === "2027-06-05" && r.code === 0 && hook(r).additionalContext.includes("2027-06-05"), r.out + r.err + read(dcFile));
  r = dc(T("05", "11:00:00"));
  check("T28e4 after that the same day prints nothing", quiet(r), r.out + r.err);

  // f. which finished threads are ready to settle
  const ev = (d, text = `day ${d}`) => m(["devlog", "event", "note", text], { at: T(d, "10:00:00"), extra: hub });
  for (const d of ["10", "11", "12", "13", "14", "15", "16"]) {
    ev(d); tune(d, { runCount: 1 });
    if (d === "15") m(["devlog", "summary", "2027-06-15", "Day fifteen is done."], { at: T("15", "18:00:00"), extra: hub });
  }
  tune("13", { settled: true });
  tune("14", { archived: true });
  { const x = fk(); delete x.threads[dthread("16")[0][0]]; sv(x); }
  tune("11", { runCount: 2, status: "running", activeRunId: "run:2" });
  tune("12", { runCount: 2, status: "waiting", pendingRequestCount: 1 });
  let f = m(["rollover", "--json"], { at: T("20"), extra: hub }).json || {};
  const ready = days28(f.settleThreads || []);
  const laterOf = (d) => (f.settleLater || []).find((t) => t.day === `2027-06-${d}`);
  check("T28f1 only idle days with the final-summary question decided are ready; today's thread is not listed", JSON.stringify(ready) === JSON.stringify(["05", "15"]) && !(f.settleThreads || []).concat(f.settleLater || []).some((t) => t.day === "2027-06-20"), JSON.stringify(f.settleThreads) + JSON.stringify(f.settleLater));
  check("T28f2 a thread that was asked for its final summary and has not run since is not ready", /final summary/.test(laterOf("10")?.reason) && laterOf("10").threadId === dthread("10")[0][0], JSON.stringify(f.settleLater));
  check("T28f3 a running thread is not ready", /running/.test(laterOf("11")?.reason), JSON.stringify(laterOf("11")));
  check("T28f4 a thread with a question open is not ready", /question/.test(laterOf("12")?.reason), JSON.stringify(laterOf("12")));
  check("T28f5 settled, archived and deleted threads are not listed, and are remembered", !laterOf("13") && !laterOf("14") && !laterOf("16") && !ready.some((d) => ["13", "14", "16"].includes(d)) && JSON.stringify(ledger28().dailySettled).includes('"2027-06-13":"settled"') && ledger28().dailySettled["2027-06-14"] === "archived" && ledger28().dailySettled["2027-06-16"] === "gone", JSON.stringify(ledger28().dailySettled));
  f = m(["rollover", "--json"], { at: T("20", "09:30:00"), extra: { ...hub, FAKE_T3_DOWN: "1" } }).json || {};
  check("T28f6 with T3 not reachable, nothing is ready and the reason says why", f.settleThreads?.length === 0 && f.settleLater?.length > 0 && f.settleLater.every((t) => t.reason === "T3 not reachable"), JSON.stringify(f.settleLater));
  tune("10", { runCount: 2 });
  tune("11", { status: "completed", activeRunId: null });
  tune("12", { status: "completed", pendingRequestCount: 0 });
  f = m(["status", "--json"], { at: T("20", "10:00:00"), extra: hub }).json || {};
  check("T28f7 mm status lists the threads once they have answered, finished and been answered", JSON.stringify(days28(f.settleThreads || [])) === JSON.stringify(["05", "10", "11", "12", "15"]) && f.settleLater?.length === 0, JSON.stringify(f.settleThreads?.map((t) => t.day)) + JSON.stringify(f.settleLater));

  // g. the day's thread starts at the day change with the work carried over, and later events go to it
  const lane = (name, title, issue) => m(["lane", "new", name, "--ns", "dev.baddergames", "--title", title, "--issue", String(issue), "--goal-file", goal, "--skip-git-check"], { at: T("24"), extra: hub });
  lane("g-run", "Fix the boss", 12); lane("g-wait", "Tune the lobby", 13); lane("g-block", "Rewrite saves", 14); lane("g-held", "Add a menu", 15);
  m(["lane", "update", "g-wait", "waiting"], { at: T("24", "09:10:00"), extra: hub });
  m(["lane", "update", "g-block", "blocked"], { at: T("24", "09:11:00"), extra: hub });
  m(["lane", "update", "g-held", "held", "--pr", "16"], { at: T("24", "09:12:00"), extra: hub });
  m(["status"], { at: T("25", "08:00:00"), extra: hub });
  const day25 = dthread("25");
  const msg = day25[0]?.[1].messages[0] || "";
  const eventLines25 = () => read(path.join(E28.MM_DEVLOG_DIR, "data", "2027-06-25.jsonl")).split("\n").filter(Boolean);
  check("T28g1 the first command of the day starts one thread with the carried-over work, grouped", day25.length === 1 && msg.includes("[devlog day start · 2027-06-25] Work carried over from earlier days:")
    && msg.includes("Running:\n- Fix the boss (g-run, baddergames) #12\n") && msg.includes("Waiting for an answer:\n- Tune the lobby (g-wait, baddergames) #13\n")
    && msg.includes("Blocked:\n- Rewrite saves (g-block, baddergames) #14\n") && msg.includes("Pull requests waiting for approval:\n- Add a menu (g-held, baddergames) #15 PR #16\n")
    && /Events of 2027-06-25 follow in this thread as messages\./.test(msg), msg.slice(-700));
  check("T28g2 the day-start message is not recorded as a devlog event", eventLines25().length === 0, eventLines25().join("\n"));
  ev("25", "later that day");
  const after = dthread("25");
  check("T28g3 a later event the same day goes to the same thread", after.length === 1 && after[0][1].messages.length === 2 && /later that day/.test(after[0][1].messages[1]) && eventLines25().length === 1, JSON.stringify(after.map(([, t]) => t.messages.length)));

  // h. a late event for a closed day reaches its thread even when settled
  m(["status"], { at: T("26", "08:00:00"), extra: hub });
  const t13 = dthread("13")[0];
  const cached = ledger28().dailySettled["2027-06-13"];
  m(["lane", "new", "late28", "--ns", "dev.baddergames", "--title", "Late merge", "--goal-file", goal, "--skip-git-check"], { at: T("26", "08:30:00"), extra: hub });
  m(["lane", "set", "late28", "--pr", "61"], { at: T("26", "08:31:00"), extra: hub });
  { const x = fk(); x.prs.push({ number: 61, state: "MERGED", mergedAt: T("13", "22:00:00"), closedAt: null }); sv(x); }
  const before13 = fk().threads[t13[0]].messages.length;
  m(["status"], { at: T("26", "09:30:00"), extra: hub });
  const msgs13 = fk().threads[t13[0]].messages;
  check("T28h1 a late event for a closed day is sent to its settled thread", fk().threads[t13[0]].settled === true && msgs13.length === before13 + 1 && /2027-06-13 is already closed; this event was recorded late/.test(msgs13.at(-1)), JSON.stringify(msgs13.slice(-1)));
  check("T28h2 and that day's settled entry is cleared so it is checked again", cached === "settled" && ledger28().dailySettled["2027-06-13"] === undefined, `${cached} → ${ledger28().dailySettled["2027-06-13"]}`);

  // k. a finalise sent to a thread settled while its day stayed open clears the settled cache
  m(["devlog", "event", "note", "k day"], { at: T("27", "10:00:00"), extra: hub });
  m(["status"], { at: T("28", "08:00:00"), extra: { ...hub, FAKE_GH_FAIL: "1" } });
  tune("27", { settled: true });
  m(["status"], { at: T("28", "08:10:00"), extra: { ...hub, FAKE_GH_FAIL: "1" } });
  const cached27 = ledger28().dailySettled["2027-06-27"];
  tune("27", { settled: false, runCount: 1 });
  r = m(["rollover", "--json"], { at: T("28", "08:20:00"), extra: hub });
  check("T28k1 after the sweep recovers, the finalise goes to the thread and its settled entry is cleared", cached27 === "settled" && r.json?.finaliseSent?.includes("2027-06-27") && ledger28().dailySettled["2027-06-27"] === undefined, JSON.stringify(r.json) + cached27);
  tune("27", { runCount: 2 });
  r = m(["rollover", "--json"], { at: T("28", "08:30:00"), extra: hub });
  check("T28k2 once it has answered, the thread is listed to settle again", days28(r.json?.settleThreads || []).includes("27"), JSON.stringify(r.json?.settleThreads));

  // j. the day check takes no lock
  const lockDir = path.join(E28.MM_STATE_DIR, ".lock");
  fs.mkdirSync(lockDir); fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid));
  r = dc(T("27"));
  fs.rmSync(lockDir, { recursive: true, force: true });
  check("T28j the day check does not wait for the mm lock", r.code === 0 && /The day has changed to 2027-06-27/.test(r.out), r.out + r.err);

  // i. a failing day check never blocks a prompt: run the hook's own command string
  const repoRoot = path.join(HERE, "..", "..", "..", "..");
  const command = JSON.parse(fs.readFileSync(path.join(repoRoot, ".agents", "settings.json"), "utf8")).hooks.UserPromptSubmit[0].hooks[0].command;
  const bash = fs.existsSync("/bin/bash") ? "/bin/bash" : "/usr/bin/bash";
  const hookRun = (extra, dir = repoRoot) => spawnSync(bash, ["-c", command], { cwd: main, encoding: "utf8", env: { ...env({ MM_NOW: T("30"), ...E28, ...hub }), CLAUDE_PROJECT_DIR: dir, ...extra } });
  const silent = (x) => x.status === 0 && x.stdout === "" && x.stderr === "";
  const ledgerFile = path.join(E28.MM_STATE_DIR, "ledger.json");
  const goodLedger = fs.readFileSync(ledgerFile, "utf8");
  fs.writeFileSync(ledgerFile, "{ this is not json");
  const bad = hookRun({});
  fs.writeFileSync(ledgerFile, goodLedger);
  check("T28i1 a broken ledger makes the hook print nothing and exit 0", silent(bad), JSON.stringify(bad));
  const noNode = hookRun({ PATH: "/nonexistent" });
  check("T28i2 with node not on the PATH the hook prints nothing and exits 0", silent(noNode), JSON.stringify(noNode));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "mm-empty-"));
  const missing = hookRun({}, empty);
  fs.rmSync(empty, { recursive: true, force: true });
  check("T28i3 with the script missing the hook prints nothing and exits 0", silent(missing), JSON.stringify(missing));
  const good = hookRun({});
  check("T28i4 the same command, with everything in place, prints the day change message", good.status === 0 && good.stderr === "" && /The day has changed to 2027-06-30/.test(JSON.parse(good.stdout).hookSpecificOutput.additionalContext), JSON.stringify(good));
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `\n      ${String(r.detail).slice(0, 600).replace(/\n/g, "\n      ")}`}`);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, tmp: keep ? tmp : undefined }));
if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
