# Demonstration: Review Gates & Verification

Live demonstration walkthrough for the Phase 6 review gates in `TASK4_IMPLEMENTATION_PLAN.md:843-872`.
Each gate has a **fast path** (pre-existing evidence, 0 min) and a **live path** (real Ollama call).

Prereqs: Ollama running (`ollama serve`), repo at `multi-agent-orchestrator`.

---

## Gate 1 — Seeded Flaw Verification

**Goal:** prove the Critic flags planted blockers (`verdict: revise` + blocker issue at the right location).

- [ ] **1a. Live (~1-2 min):**
  ```bash
  pnpm orch run -c D -t "Add email domain validation in corpus/mini-auth-utils-pristine/tests/validator.email.test.ts (reject if not ending with @company.com)"
  ```
- [ ] **1b. Evidence (0 min)** — `results/trajectories-config-d-(critic-isolated).json` (catch = **first** review verdict, per `evals/metrics.ts`):
  - [ ] `seeded-1` → first review `"verdict": "approve"` (MISSED → honest rubber-stamp)
  - [ ] `seeded-2` → `revise × 3` → escalated (caught)
  - [ ] `seeded-3` → `revise → approve` (caught, then fixed)
  - [ ] Configs B and C caught **3/3 (100%)** this run; D caught 2/3 = 0.667, NOT fabricated

**Talk track:** "Config D's Critic caught 2 of 3 planted bugs and rubber-stamped the 3rd — that's the real 66.7%, not a faked 100%. (Configs B and C caught all 3.)"

---

## Gate 2 — Revision Cap Enforcement

**Goal:** prove round 4 escalates instead of looping forever.

- [ ] **2a. Automated:** `pnpm test` → *"triggers escalation when max revision cap is reached"* passes (`finalOutcome === 'escalated'`, `escalation.reason === 'max-revisions-hit'`).
- [ ] **2b. Evidence:** grep `results/trajectories-config-d-(critic-isolated).json`:
  ```bash
  rg -c 'max-revisions-hit' results/trajectories-config-d-\(critic-isolated\).json   # expect 7 (this run)
  ```
  - [ ] **7 escalations** in Config D this run (e.g. `seeded-2`, `ambiguous-2`) → `finalOutcome: escalated`, `escalation.reason: max-revisions-hit`, `totalTurns: 3`.

**Talk track:** "The loop is hard-capped. Three rejected rounds → human escalation, never an infinite loop."

---

## Gate 3 — Process Quality Spot-Check

**Goal:** manually read trajectories and compare with automated metrics.

- [ ] Open 3 trajectories from different tasks/configs:
  - [ ] `seeded-1` (config D) — the **missed flaw** (first review approved): is the Critic missing real bugs, or inventing issues?
  - [ ] `well-1` (config B) — did the Executor act on feedback or rubber-stamp?
  - [ ] `seeded-3` (config D) — caught on first review, approved after the fix: did the revision genuinely resolve the issue?
- [ ] Compare your read to `results/comparison.json`: catch B/C = 1.0, D = 0.667; rubber-stamp B/C = 0, D = 0.143 — align with manual reading.

**Talk track:** "Manual read matches the automated numbers — B and C caught everything, D missed one (66.7%), rubber-stamp D = 14.3%. That's the manual-vs-automated alignment the gate requires."

---

## Gate 4 — Results Reproducibility

- [ ] **Fast:** `pnpm orch eval --golden` → `docs/RESULTS.md` identical to `results/comparison.json`.
- [ ] **Hand-calc:** Config C wall-clock = 660,504 ms / 15 = 44,034 ms; Config D = 529,217 ms / 15 = 35,281 ms — both match `comparison.json`.
- [ ] **No mock leakage:** `rg "Proposed implementation code patch" results/` → **0 matches**.
- [ ] **Full (optional, ~60 min):** fresh clone → `pnpm install` → `pnpm orch run-all --golden` → `pnpm orch eval --golden` → all numbers match.

**Talk track:** "Every number in the docs traces back to raw trajectory files — recomputed, not copied. Nothing is fabricated."

---

## Supporting Evidence (any time)

- [ ] `pnpm test` → **14/14 passing**.
- [ ] Isolation guard: `harness.test.ts` third test — Config C critic context *contains* Executor reasoning; Config D does not (context is patch code only).
- [ ] All 4 configs: `sampleSize: 15`, zero `[TASK FAILED]` in the run summary.
