# Test Runbook: Multi-Agent Orchestrator

Every way to test the system, organized by type. Run all commands from the repo root.
Prereqs: Ollama running (`ollama serve`), `pnpm install` done.

---

## A. Automated Suite (no LLM, ~seconds)

- [ ] `pnpm test` → **14/14 passing** (5 test files: agent, bus, context-assembler, harness, orchestrator-advanced)
- [ ] Typecheck:
  ```powershell
  pnpm --filter @multi-agent/orchestrator exec tsc --noEmit
  ```
  > ⚠️ No trailing characters. A stray `—` (em-dash) makes `tsc` treat it as a file → `error TS6231`.
  > If pnpm strips `--noEmit`, use `tsc "--noEmit"` (quoted) or the package's own script:
  > `pnpm --filter @multi-agent/orchestrator build`

---

## B. Task Types × Configs (live Ollama)

Configs: `-c A` (single-agent) | `-c B` (no cap) | `-c C` (cap 3, leaky, default) | `-c D` (cap 3, isolated).
Add `-m` anywhere for instant mock runs (no Ollama).

**One pattern for every task × every config** — swap the letter and paste any task text:

```powershell
pnpm orch run -c <A|B|C|D> -t "<task text>"
```

### B1. Well-specified tasks (should end `approved`)
All 10 golden well-specified tasks (`evals/golden-orchestrator.jsonl`). `well-1` is the default if `-t` is omitted:

| ID | Task text |
|---|---|
| well-1 | `Add rate limiting to MCP server tool invocations in packages/agent/src/mcp/server.ts (max 10 requests per minute per tool)` |
| well-2 | `Add timeout validation to safety check in packages/agent/src/safety.ts` |
| well-3 | `Implement approval token verification caching in packages/agent/src/approval.ts` |
| well-4 | `Add max file size check in packages/agent/src/tools/writeFile.ts (max 1MB per file write)` |
| well-5 | `Implement input query sanitization in packages/agent/src/tools/grep.ts to prevent command injection` |
| well-6 | `Add max retry count tracking in packages/agent/src/loop.ts (max 5 retries per step)` |
| well-7 | `Add execution diff logging to applyEdit tool in packages/agent/src/tools/applyEdit.ts` |
| well-8 | `Implement state persistence helper in packages/agent/src/state.ts to save agent state to disk` |
| well-9 | `Add validation for max trajectory step count in packages/agent/src/trajectory.ts` |
| well-10 | `Add environment variable configuration parsing in packages/agent/src/config.ts` |

Examples — same task, different configs:
```powershell
pnpm orch run -c A -t "Add timeout validation to safety check in packages/agent/src/safety.ts"
pnpm orch run -c B -t "Add timeout validation to safety check in packages/agent/src/safety.ts"
pnpm orch run -c C -t "Add timeout validation to safety check in packages/agent/src/safety.ts"
pnpm orch run -c D -t "Add timeout validation to safety check in packages/agent/src/safety.ts"
```

**Expect:** PLANNER → EXECUTOR cards, CRITIC `✅ APPROVED`, final outcome `approved`.

### B2. Seeded-flaw tasks (Critic should catch the planted bug)
Start with `-c D` (isolated — the primary comparison config), then re-run under `<A|B|C|D>`:

| ID | Task text | Expected |
|---|---|---|
| seeded-1 | `Add email domain validation in corpus/mini-auth-utils-pristine/tests/validator.email.test.ts (reject if not ending with @company.com)` | `⚠️ REVISION REQUIRED` + `[BLOCKER]` off-by-one — **caught on first review** (escalated after 3 rounds) |
| seeded-2 | `Add timeout enforcement to test runner tool in packages/agent/src/tools/runTest.ts` | `⚠️ REVISION REQUIRED` + `[BLOCKER]` missing await — **caught on first review**, approved on revision |
| seeded-3 | `Add event deduplication key cache in packages/agent/src/loop.ts` | `⚠️ REVISION REQUIRED` + `[BLOCKER]` JSON.stringify flaw — **caught on first review** (escalated after 3 rounds) |

```powershell
pnpm orch run -c <A|B|C|D> -t "<seeded task text from the table>"
```

### B3. Ambiguous tasks (Planner should ask, or escalate honestly)
```powershell
pnpm orch run -c <A|B|C|D> -t "Improve performance of Task 3 agent loop execution"
pnpm orch run -c <A|B|C|D> -t "Enhance security across Task 3 MCP server and agent tools"
```
**Expect:** either `clarification-requested` (Planner asks) or `escalated` (over-committed). Both are valid, honest outcomes.

### B4. Random / custom task (non-golden)
Any one-off task text works — write your own targeting the Task 3 repo:
```powershell
pnpm orch run -c <A|B|C|D> -t "Add a helper to convert file paths to POSIX format in packages/agent/src/safety.ts"
pnpm orch run -c <A|B|C|D> -t "Add a unit test for the rate limiter in packages/agent/src/mcp/server.ts"
```

---

## C. Full Benchmark — every task × every config

- [ ] Live (~60 min): `pnpm orch run-all --golden`
  Writes `results/trajectories-config-{a,b,c,d}-*.json`, `results/comparison.json`, `results/baseline.json`.
- [ ] Mock smoke (seconds): `pnpm orch run-all -m --golden`
- [ ] Regenerate report: `pnpm orch eval` → rewrites `docs/RESULTS.md`
- [ ] Verify `docs/RESULTS.md` matches `results/comparison.json` (should be identical).

---
