# Implementation Notes: Failure Modes & Mitigations

## 1. Sycophantic Critic Deep-Dive

### Observation & Findings
LLM code reviewers can demonstrate sycophancy when shown the author's self-reasoning. In this live run, the Critic caught 3 of 3 seeded flaws in Configs B and C (100%) and 2 of 3 in Config D (66.7%). Rubber-stamp rates were B: 0%, C: 0%, D: 14.3%. Isolated Config D caught fewer seeded flaws than non-isolated Configs B/C, so the anti-sycophancy benefit of isolation is not confirmed by this run.

### Root Cause
1. Prompts that present the Critic as a "helpful assistant" rather than an "adversarial code reviewer".
2. Inclusion of `patch.reasoning` in the Critic prompt context.

### Applied Mitigation & Evidence
- **Strict Context Isolation**: Implemented `ContextAssembler.getCriticContext(task, patch, enforceStrictIsolation: true)` in `packages/orchestrator/src/harness/context-assembler.ts`, stripping out `patch.reasoning` and author justifications.
- **Empirical Evidence**: In Config D (Isolated), the Critic catch rate on seeded flaws was 66.7% (2/3) with a 14.3% rubber-stamp rate — lower than Configs B/C (100%), but the lowest per-task cost (3,400 tokens, 35.3s) and fastest wall-clock among critic configs.

---

## 2. Confabulated Blockers Deep-Dive

### Observation
LLMs acting as reviewers can invent non-existent security or stylistic flaws ("ghost blockers") to appear thorough.

### Root Cause
Lack of clear severity distinction between critical bugs and optional style suggestions.

### Applied Mitigation & Evidence
- **Severity Classification**: Required Critic issues to be explicitly tagged as `blocker` (must fix: logic errors, crashes, off-by-one errors) vs `minor` (suggestions: formatting, optional polish).
- **Rule Enforcement**: The orchestrator only triggers a `revise` verdict if at least one `blocker` issue is present. Minor suggestions alone do not block approval.

---

## 3. Context Leakage & Boundary Verification

### Prevention Mechanism
- `ContextAssembler` enforces typed context boundaries per agent role:
  - **Planner Context**: Task + codebase snapshot.
  - **Executor Context**: Task + Plan + codebase snapshot.
  - **Critic Context**: Original task + raw code patch string ONLY.

### Verification Tests
- Verified via unit test `packages/orchestrator/src/harness/context-assembler.test.ts` asserting `criticContext.patchCode` does NOT contain `patch.reasoning`.

---

## Design Decisions Summary

### Decisions That Worked Well
- **Typed Message Contracts (`messages.ts`)**: Zod validation schemas prevented malformed agent communications.
- **3-Round Revision Cap**: Halts un-bounded revision loops and triggers EscalationResult, controlling token spend by **~34-46%** vs the unbounded config (B 6,270 → C 4,151 / D 3,400 tokens/task).
- **Context Isolation**: Enforces a strict context boundary (verified by unit test). In this run it did not eliminate sycophancy — Config D caught 66.7% of seeded flaws vs 100% for B/C — but Config D achieved the lowest per-task cost (3,400 tokens, 35.3s).

### Decisions Excluded (Out of Scope)
- Production distributed queues, persistent databases, multi-server infrastructure, and model fine-tuning were intentionally excluded to focus on multi-agent disagreement dynamics and trajectory evaluation.

## 4. Manual Process Spot-Check

### Method
Manually inspected a sample of `results/trajectories-config-*.json` to confirm the benchmark reflects genuine LLM behavior, not mock output.

### Checks performed
- **Mock leakage**: Searched all trajectory files for the mock Executor signature `// Proposed implementation code patch` — **0 matches** (all live Ollama data).
- **Task coverage**: All 4 configs contain 15/15 golden tasks (`sampleSize: 15`); no `[TASK FAILED]` entries.
- **Internal consistency**: `comparison.json` wall-clock totals recompute exactly from raw trajectories (Config C: 660,504 ms / 15 = 44,034 ms; Config D: 529,217 ms / 15 = 35,281 ms).
- **Outcome realism**: Config C outcomes include `approved`, `escalated` (revision cap hit), and `clarification-requested` (ambiguous tasks) — matching the expected golden-task mix.

### Result
The results in `docs/RESULTS.md` are verified live-benchmark numbers.