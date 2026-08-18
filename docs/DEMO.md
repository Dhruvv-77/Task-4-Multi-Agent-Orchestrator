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
- [ ] **1b. Evidence (0 min)** — `results/trajectories-config-d-(critic-isolated).json`:
  - [ ] `seeded-1` → first review `"verdict": "revise"` (off-by-one caught, escalated after 3 rounds)
  - [ ] `seeded-2` → first review `"verdict": "revise"` (missing-await caught, approved on revision)
  - [ ] `seeded-3` → first review `"verdict": "revise"` (JSON.stringify flaw caught, escalated after 3 rounds)
  - [ ] **All 3 seeded tasks caught on first review → catch rate 1.0, NOT fabricated**

**Talk track:** "The Critic caught all 3 planted bugs and flagged them as blockers at the right spot. First-review catch rate is 100% — not a faked number."

---

## Gate 2 — Revision Cap Enforcement

**Goal:** prove round 4 escalates instead of looping forever.

- [ ] **2a. Automated:** `pnpm test` → *"triggers escalation when max revision cap is reached"* passes (`finalOutcome === 'escalated'`, `escalation.reason === 'max-revisions-hit'`).
- [ ] **2b. Evidence:** grep `results/trajectories-config-d-(critic-isolated).json`:
  ```bash
  rg -c 'max-revisions-hit' results/trajectories-config-d-\(critic-isolated\).json
  ```
  - [ ] **5 escalations** in Config D this run (e.g. `seeded-1`, `seeded-3`, `well-7`, `ambiguous-2`) → `finalOutcome: escalated`, `escalation.reason: max-revisions-hit`, `totalTurns: 3`.

**Talk track:** "The loop is hard-capped. Three rejected rounds → human escalation, never an infinite loop."

---

## Gate 3 — Process Quality Spot-Check

**Goal:** manually read trajectories and compare with automated metrics.

- [ ] Open 3 trajectories from different tasks/configs:
  - [ ] `seeded-1` (config D) — **caught on first review**, escalated after 3 rounds: did the Executor address Critic feedback across revisions?
  - [ ] `well-1` (config B) — did the Executor act on feedback or rubber-stamp?
  - [ ] `seeded-3` (config D) — **caught on first review**, escalated after 3 rounds: is the Critic inventing issues, or missing real ones?
- [ ] Compare your read to `results/comparison.json`: `criticCatchRate` 1.0 and `rubberStampRate` 0 align with manual reading.

**Talk track:** "Manual read matches the automated numbers — 3/3 catch, 0% rubber-stamp. That's the manual-vs-automated alignment the gate requires."

---

## Gate 4 — Results Reproducibility

- [ ] **Fast:** `pnpm orch eval` → `docs/RESULTS.md` identical to `results/comparison.json`.
- [ ] **Hand-calc:** Config C wall-clock = 581,773 ms / 15 = 38,785 ms; Config D = 422,689 ms / 15 = 28,179 ms = values in `comparison.json`.
- [ ] **No mock leakage:** `rg "Proposed implementation code patch" results/` → **0 matches**.
- [ ] **Full (optional, ~60 min):** fresh clone → `pnpm install` → `pnpm orch run-all --golden` → `pnpm orch eval` → all numbers match.

**Talk track:** "Every number in the docs traces back to raw trajectory files — recomputed, not copied. Nothing is fabricated."

---

## Supporting Evidence (any time)

- [ ] `pnpm test` → **14/14 passing**.
- [ ] Isolation guard: `harness.test.ts` third test — Config C critic context *contains* Executor reasoning; Config D does not (context is patch code only).
- [ ] All 4 configs: `sampleSize: 15`, zero `[TASK FAILED]` in the run summary.