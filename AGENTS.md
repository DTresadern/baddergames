# AGENTS.md

Placeholder. Shared instructions for all coding agents (Claude Code, Codex, others).

## Layout

- `.agents/` - agent-agnostic config
- `.agents/skills/` - shared skills, one folder per skill containing `SKILL.md`
- `.claude` - symlink to `.agents`, so Claude Code reads the same skills
- `CLAUDE.md` - imports this file; keep project instructions here, not there
