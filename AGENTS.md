# AGENTS.md

Placeholder. Shared instructions for all coding agents (Claude Code, Codex, others).

## Layout

- `.agents/` - agent-agnostic config
- `.agents/skills/` - shared skills, one folder per skill containing `SKILL.md`
- `.claude` - symlink to `.agents`, so Claude Code reads the same skills
- `CLAUDE.md` - imports this file; keep project instructions here, not there
- `.mastermind/config.json` - namespaces (sub-projects and their folders), time zone and orchestration models
- `.agents/skills/mastermind/` - the orchestrator skill and its `mm` script (`mm help`)
- `devlog/` - the local daily devlog, written by `mm` (gitignored)
- one folder per sub-project, for example `berserker7/`, each with its own `AGENTS.md`
