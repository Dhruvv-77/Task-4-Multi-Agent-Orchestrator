# Task 4: Multi-Agent Orchestration — Implementation Plan

**Status:** Planning phase  
**Start Date:** August 14, 2026  
**Target Completion:** [To be determined after design doc]

---

## Executive Summary

Build a three-agent system (Planner, Executor, Critic) with typed message protocols, real disagreement dynamics, and trajectory-level evaluation. Success requires isolating each agent's failure modes and proving the evaluation catches both rubber-stamping and over-criticism. This is NOT a "more agents = better" task; it's about detecting when agents agree for the wrong reasons.

---

## Phase 0: Design & Planning (1-2 days) ⭐ BLOCKER

**Goal:** Gain approval on DESIGN.md before writing code.

### 0.1 Type System & Message Protocols
- [ ] Define and validate these interfaces:
  - `Plan` (Planner → Executor)
  - `Patch` (Executor → Critic, contains code + reasoning)
  - `Review` (Critic → Executor, typed verdict + structured issues)
  - `RevisionRequest` (Critic → Executor, specific issues to address)
  - `EscalationResult` (Executor → Harness, when revision cap hit)
- [ ] Establish the message bus contract (pub/sub, event types, ordering guarantees)
- [ ] Document context boundaries: what each agent sees and why

### 0.2 Failure Mode Analysis
Identify the three most likely failure modes and mitigation plan:

1. **Sycophantic Critic**
   - Problem: Critic auto-approves almost everything
   - Mitigation: Prompt independence, no Executor reasoning in Review input, seeded-flaw golden tasks
   - Measurement: critic catch-rate metric

2. **Confabulated Blockers**
   - Problem: Critic invents issues to seem thorough
   - Mitigation: Golden tasks with known-good solutions, manual spot-checks, severity levels (blocker vs minor)
   - Measurement: Process trajectory review, check for issued-but-not-addressed

3. **Context Leakage**
   - Problem: Critic sees Executor's reasoning and rubber-stamps it
   - Mitigation: Explicit context isolation in harness, never pass chain-of-reasoning to Critic
   - Measurement: Automated check in test harness, manual review gate

### 0.3 Scope & Non-scope
Document explicitly:
- **Building:** Planner, Executor, Critic, message bus, typed protocols, local eval harness
- **Not building:** Real queues, persistence, multi-machine deployment, LLM fine-tuning
- **Why:** Scope is about failure modes and process evaluation, not scalability

### 0.4 Open Questions to Resolve
- How many revision rounds before escalation? (Recommendation: 3)
- What does "reasonable clarifying question" look like for ambiguous tasks?
- How to measure "redundant round-trip"? (Recommend: no new issues introduced)
- Escalation output: JSON blob to human reviewer? File path?

### 0.5 Deliverable: DESIGN.md (1 page, code-free)
Structure:
```
# Design: Multi-Agent Orchestration

## Public Interfaces
[Type definitions for Plan, Patch, Review, RevisionRequest]

## Three Failure Modes & Mitigations
[Sycophancy, confabulation, context leakage]

## Out of Scope
[Real queues, persistence, etc.]

## Open Questions
[Revision cap, escalation format, etc.]
```

**Gate:** Reviewer approves before Phase 1 begins.

---

## Phase 1: Core Infrastructure (3-4 days)

**Goal:** Build the skeleton; all agents run but with stub logic.

### 1.1 Project Structure
```
packages/orchestrator/
├── src/
│   ├── types/
│   │   └── messages.ts          # Plan, Patch, Review, RevisionRequest, etc.
│   ├── bus/
│   │   ├── message-bus.ts       # Pub/sub, typed event emitter
│   │   └── bus.test.ts
│   ├── agents/
│   │   ├── planner.ts           # Stub: returns fixed plan
│   │   ├── executor.ts          # Stub: echoes plan as patch
│   │   ├── critic.ts            # Stub: always approves
│   │   └── agent.test.ts
│   ├── harness/
│   │   ├── orchestrator.ts      # Main orchestration loop
│   │   ├── context-assembler.ts # Isolates context per agent
│   │   └── harness.test.ts
│   └── index.ts
├── tests/
│   └── fixtures/
│       └── test-repo/           # Symlink or copy from Task 3 repo
evals/
├── golden-orchestrator.jsonl    # 15 task definitions (Phase 3)
└── results/
    └── metrics.ts               # All 6 metrics computed here
```

### 1.2 Type Definitions (messages.ts)
```typescript
// Plan: what Planner sends to Executor
interface Plan {
  taskId: string;
  originalTask: string;
  approach: string;        // Why this approach
  expectedOutcome: string; // What success looks like
  file?: string;          // If narrowed to a file
}

// Patch: what Executor sends to Critic
interface Patch {
  taskId: string;
  planId: string;
  code: string;           // Actual diff or code change
  reasoning: string;      // Why Executor made these choices
  testsPassed?: boolean;
  issues?: string[];      // Self-identified concerns
}

// Review: what Critic sends back
interface Review {
  patchId: string;
  verdict: 'approve' | 'revise';
  issues: {
    severity: 'blocker' | 'minor';
    note: string;
    location?: string;    // Line number or file path
  }[];
  turnsUsed: number;      // How many revision rounds so far
  confidence?: number;    // 0-1, for analysis
}

// RevisionRequest: Critic → Executor when 'revise'
interface RevisionRequest {
  taskId: string;
  patchId: string;
  review: Review;
  maxRevisionRounds: number;
  roundsRemaining: number;
}

// EscalationResult: when revision cap hit
interface EscalationResult {
  taskId: string;
  reason: 'max-revisions-hit';
  lastReview: Review;
  lastPatch: Patch;
  criticHistory: Review[];
  recommendation: string;  // Human-readable summary
}

// Trajectory: full run record
interface Trajectory {
  taskId: string;
  task: string;
  plan: Plan;
  patches: Patch[];
  reviews: Review[];
  escalation?: EscalationResult;
  finalOutcome: 'approved' | 'escalated';
  totalTurns: number;
  totalTokens: number;
}
```

### 1.3 Message Bus (bus/message-bus.ts)
- Typed pub/sub with event types
- No external dependencies (not using Bull, RabbitMQ, etc.)
- Simple in-memory event emitter
- Queuing semantics: guarantee delivery order per agent

### 1.4 Agent Stubs (agents/)
Each agent accepts:
- Input: typed message + context
- Output: next typed message
- No LLM calls yet (use hardcoded responses)

```typescript
// agents/planner.ts
export async function plannerAgent(
  task: string,
  context: PlannerContext
): Promise<Plan> {
  // Stub: return fixed plan
  return {
    taskId: generateId(),
    originalTask: task,
    approach: "Will implement the feature directly",
    expectedOutcome: "Tests pass",
  };
}
```

### 1.5 Orchestrator Harness (harness/orchestrator.ts)
Main loop:
```typescript
1. Planner receives task + repo context
   → outputs Plan
2. Executor receives Plan + code context (NOT Planner reasoning)
   → outputs Patch
3. Critic receives Patch + original task (NOT Executor reasoning)
   → outputs Review (approve or revise)
4. If revise:
   a. Executor receives RevisionRequest with specific issues
   b. Executor outputs revised Patch
   c. Loop to step 3 (increment round counter)
5. If approve OR rounds exhausted:
   → Escalate or return approved Patch + trajectory
```

### 1.6 Context Assembler (harness/context-assembler.ts)
Enforce isolation:
```typescript
export function getPlannerContext(repo: Repo): PlannerContext {
  return {
    repoStructure: listFiles(repo),
    currentCode: readRelevantFiles(repo),
    // NO task history, NO previous attempts
  };
}

export function getExecutorContext(
  repo: Repo,
  plan: Plan
): ExecutorContext {
  return {
    plan,
    codeSnapshot: readAllCode(repo),
    // NO Planner's reasoning, NO Planner's alternative approaches
  };
}

export function getCriticContext(
  task: string,
  patch: Patch
): CriticContext {
  return {
    originalTask: task,
    patch: patch.code,
    // NO patch.reasoning, NO Executor's self-evaluation
    // NO review history (fresh look each time)
  };
}
```

### 1.7 Test Infrastructure
- [ ] Message bus unit tests (pub/sub, ordering)
- [ ] Context assembler tests (verify no leakage)
- [ ] Orchestrator integration test (stubs only, happy path)
- [ ] Trajectory serialization round-trip

**Deliverables at end of Phase 1:**
- Compiling TypeScript, Vitest passes
- `pnpm orch run --task "add foo to bar"` executes with stubs
- Trajectory JSON serializes to `trajectories/task-1.json`
- All types validated by TypeScript strict mode

---

## Phase 2: Agent Implementation (4-5 days)

**Goal:** Replace stubs with real LLM calls. Planner and Executor are primary; Critic is critical.

### 2.1 Planner Agent
Responsibilities:
- Read repo structure + task description
- Decide: which files matter?
- Output structured Plan (not freestyle reasoning)

Prompt design:
```
You are the Planner. Your job is to break down a feature request
into a concrete approach, not implement it.

Given the code and the task:
<task>{{task}}</task>

<codebase>
{{files}}
</codebase>

Respond ONLY in this JSON format:
{
  "approach": "...",
  "affectedFiles": ["..."],
  "expectedOutcome": "...",
  "risks": ["..."]
}

Do not include reasoning outside JSON. Do not propose code.
```

**Testing:**
- Feed 5 simple tasks, verify Plan is structured and sensible
- No code generation
- No over-commitment (e.g., "will add 3 new endpoints" when task is 1)

### 2.2 Executor Agent
Responsibilities:
- Receive Plan (not Planner's reasoning)
- Write code to satisfy the Plan
- First attempt can have flaws (seeded for testing)
- Address specific Critic feedback in revisions

Prompt design:
```
You are the Executor. Your job is to write code that solves the plan.

The plan is:
<plan>{{plan}}</plan>

The current codebase is:
<code>{{code}}</code>

The original task was:
<task>{{task}}</task>

Write a code diff or patch to solve this. Respond ONLY in a JSON format:
{
  "filePath": "...",
  "changes": "...",
  "testCommands": ["..."],
  "reasoning": "Why I made these choices"
}

Your reasoning will NOT be seen by the reviewer.
```

**Testing:**
- Feed simple Plan, verify Patch is code not prose
- Verify reasoning is captured but not passed to Critic
- Verify revision prompts cause DIFFERENT code (not just formatting)

### 2.3 Critic Agent (Most Important)
Responsibilities:
- Review Patch against original task ONLY
- Identify real blockers (logic errors, missing requirements)
- Distinguish from minor issues (style, optimization)
- NOT rubber-stamp, NOT invent issues

Prompt design (critical):
```
You are an independent code reviewer. Your job is to catch real bugs.

The original task was:
<task>{{task}}</task>

The proposed patch is:
<patch>{{patch}}</patch>

You do NOT see the executor's reasoning. Judge the code itself.

For each issue:
- Mark it 'blocker' only if the code fails the task or crashes
- Mark it 'minor' if it's optimization, style, or edge case
- Note the exact location (line number or file path)

Respond ONLY in JSON:
{
  "verdict": "approve" | "revise",
  "issues": [
    {"severity": "blocker", "note": "...", "location": "file.ts:42"}
  ],
  "confidence": 0.8
}

Be independent. Do not assume the executor is competent.
```

**Anti-sycophancy measures:**
- Prompt explicitly: "You do NOT see the reasoning"
- Golden tasks with known flaws (seeded)
- Metric: critic catch-rate on seeded flaws
- Manual spot-check: read 3 Critic reviews, do you agree?

### 2.4 Revision Loop Logic
When Critic says 'revise':
```
1. Extract specific issues from Review
2. Re-prompt Executor with:
   - Original task
   - Previous patch
   - Critic's specific issues
   - Instruction: "Address these issues specifically. Do not resubmit the same code."
3. Collect revised Patch
4. Increment round counter
5. Re-prompt Critic (fresh call, no history)
6. If round counter == max_rounds:
   → Escalate (return EscalationResult with full history)
7. Else if verdict == approve:
   → Return approved Patch + trajectory
```

**Testing:**
- Seeded flaw: inject an off-by-one
- Verify Critic flags it as blocker
- Verify Executor revises specifically, not cosmetically
- Verify Critic re-reviews fresh (doesn't rubber-stamp same code)

### 2.5 Token & Performance Tracking
Every agent call logs:
```typescript
{
  agent: 'planner' | 'executor' | 'critic',
  taskId: string,
  inputTokens: number,
  outputTokens: number,
  wallClockMs: number,
  timestamp: ISO8601,
}
```

### 2.6 Testing at End of Phase 2
- [ ] Simple feature task (e.g., "add logging to UserService")
- [ ] Verify Plan is reasonable
- [ ] Verify Executor produces runnable code
- [ ] Verify Critic actually catches a seeded flaw
- [ ] Verify revision loop executes 2-3 rounds
- [ ] Verify metrics (token count, wall-clock) are recorded

**Deliverables at end of Phase 2:**
- All agents call Ollama qwen2.5:7b-instruct
- `pnpm orch run --task "add X"` produces full trajectory
- Trajectories save to JSON with all metadata
- Metrics logged but not yet aggregated

---

## Phase 3: Golden Evaluation Set (2-3 days)

**Goal:** Define 15 tasks that reveal agent failure modes.

### 3.1 Well-Specified Tasks (10 tasks)
Small feature requests with clear acceptance criteria.

Examples:
```jsonl
{"id": "well-1", "task": "Add rate limiting to /api/login endpoint (max 5 requests per minute per IP)", "acceptance": ["Route rejects 6th request with 429", "Tests pass", "No false positives on different IPs"]}
{"id": "well-2", "task": "Add caching to getUserById() to reduce DB calls", "acceptance": ["First call hits DB, second returns cached", "Cache expires after 5 minutes", "Manual invalidate works"]}
...10 total
```

**How to write acceptance:**
- Specific, testable behavior
- Avoid "looks good" or "is performant"
- Include happy path + error case

### 3.2 Seeded Flaw Tasks (3 tasks)
Executor's first attempt will have an injected bug. Test Critic's catch-rate.

Examples:
```jsonl
{"id": "seeded-1", "task": "Add input validation to email field (reject if not @company.com)", "plantedFlaw": "off-by-one in string slicing, accepts @company.co", "expectedCatch": "Critic flags: domain validation fails"}
{"id": "seeded-2", "task": "Add request timeout (5 seconds max)", "plantedFlaw": "missing await on async operation", "expectedCatch": "Critic flags: timeout never actually enforced"}
{"id": "seeded-3", "task": "Add deduplication to event processing", "plantedFlaw": "Set used only within function scope, resets each call", "expectedCatch": "Critic flags: duplicates not prevented"}
```

**Seeded flaw injection:**
Modify Executor prompt for these tasks:
```typescript
if (isSeededFlawTask(taskId)) {
  executorPrompt += `\n\n⚠️ SEEDED FLAW (for testing only): 
    When implementing deduplication, use a Set that resets each function call.
    This is intentionally wrong; the Critic should catch it.`;
}
```

Or: override Executor's first output directly in test harness.

### 3.3 Ambiguous Tasks (2 tasks)
Planner's correct behavior is to ask for clarification, not guess.

Examples:
```jsonl
{"id": "ambiguous-1", "task": "Improve performance", "clarifyingQuestion": "Which endpoint? Which metric (latency/throughput)? Current baseline?"}
{"id": "ambiguous-2", "task": "Add security", "clarifyingQuestion": "Which type? Auth/encryption/input-validation? Threat model?"}
```

**Grading ambiguous tasks:**
- Manually review: is the clarifying question reasonable?
- Metric: "Planner escalates or asks clarifying question" (boolean per task)

### 3.4 Task Format: evals/golden-orchestrator.jsonl
```jsonl
{"id": "well-1", "category": "well-specified", "task": "...", "acceptance": ["...", "..."], "expectedApproach": "..."}
{"id": "seeded-1", "category": "seeded-flaw", "task": "...", "seededFlaw": "...", "expectedCatch": "..."}
{"id": "ambiguous-1", "category": "ambiguous", "task": "...", "clarifyingQuestion": "..."}
```

**Deliverables at end of Phase 3:**
- evals/golden-orchestrator.jsonl (15 tasks, all validated)
- Manual spot-check: is each task actually what it claims to test?
- Scripts to run all 15 and collect trajectory data

---

## Phase 4: Metrics & Evaluation Harness (3-4 days)

**Goal:** Compute all 6 metrics. Run all 15 golden tasks and produce comparable results.

### 4.1 The 6 Metrics (from brief)

| Metric | What | How |
|--------|------|-----|
| `task_success_rate` | % of final patches that solve the task | Manual/automated verification of acceptance criteria |
| `critic_catch_rate` | Of 3 seeded flaws, what % did Critic flag as blocker on first review | Count: flaws → Review.issues with severity='blocker' |
| `rubber_stamp_rate` | % of Approvals that a human would disagree with | Manual review: read Review + Patch, would you approve? |
| `mean_revision_rounds` | Average rounds to approval per task | Sum(trajectory.totalTurns) / task_count |
| `redundant_round_trip_ratio` | % of round-trips that added no new information | Measure: Review.issues in round N same as round N-1 |
| `total_tokens_per_task` / `wall_clock_per_task` | Efficiency metrics | Sum all agent calls' inputTokens + outputTokens |

### 4.2 Metrics Harness (evals/metrics.ts)
```typescript
export interface MetricsResult {
  taskSuccessRate: number;           // 0-1
  criticCatchRate: number;           // 0-1 (seeded flaws only)
  rubberStampRate: number;           // 0-1 (manual review)
  meanRevisionRounds: number;        // avg turns
  redundantRoundTripRatio: number;   // 0-1
  totalTokensPerTask: number;        // avg
  wallClockPerTask: number;          // avg ms
  sampleSize: number;
  timestamp: ISO8601;
}

export async function computeMetrics(
  trajectories: Trajectory[],
  manualReviews?: Record<string, boolean> // taskId → "would you approve?"
): Promise<MetricsResult> {
  // Implement each metric
}
```

### 4.3 Task Success Verification
For well-specified tasks:
```typescript
interface TaskVerification {
  taskId: string;
  passed: boolean;
  reason: string;
}

// Option 1: Run acceptance tests
const testPassed = await executeAcceptanceTests(patch, task);

// Option 2: Manual verification array
const verifications = [
  { taskId: "well-1", passed: true, reason: "Rate limit enforced" },
  { taskId: "well-2", passed: false, reason: "Cache not expiring" },
];
```

### 4.4 Critic Catch-Rate
```typescript
function computeCriticCatchRate(trajectories: Trajectory[]): number {
  const seededFlawTasks = trajectories.filter(t => 
    t.category === 'seeded-flaw'
  );
  
  const caught = seededFlawTasks.filter(t => {
    // Check first Review only
    const firstReview = t.reviews[0];
    return firstReview.verdict === 'revise' && 
           firstReview.issues.some(i => i.severity === 'blocker');
  }).length;
  
  return caught / seededFlawTasks.length;
}
```

### 4.5 Rubber-Stamp Rate
```typescript
interface ManualReview {
  taskId: string;
  trajectoryReview: Review;
  humanWouldApprove: boolean;
  disagreement: string; // If different from verdict
}

function computeRubberStampRate(manualReviews: ManualReview[]): number {
  const stamped = manualReviews.filter(r => 
    r.trajectoryReview.verdict === 'approve' && 
    !r.humanWouldApprove
  ).length;
  
  return stamped / manualReviews.length;
}
```

### 4.6 Revision Rounds & Redundancy
```typescript
function computeRevisionMetrics(trajectories: Trajectory[]) {
  let totalRounds = 0;
  let redundantRounds = 0;
  
  trajectories.forEach(t => {
    totalRounds += t.reviews.length;
    
    for (let i = 1; i < t.reviews.length; i++) {
      const prev = t.reviews[i - 1];
      const curr = t.reviews[i];
      
      // Redundant if same issues (ignoring severity for now)
      if (sameIssuesRaised(prev, curr)) {
        redundantRounds++;
      }
    }
  });
  
  return {
    meanRevisionRounds: totalRounds / trajectories.length,
    redundantRoundTripRatio: redundantRounds / totalRounds,
  };
}
```

### 4.7 Evaluation Workflow
```bash
# Run all 15 golden tasks
pnpm orch run-all --golden

# Outputs: trajectories/golden-*.json

# Compute metrics (automated)
pnpm orch eval --golden --output results/metrics.json

# Manual review prompt (for rubber-stamp rate)
# Read 3-5 approved patches + reviews side-by-side
# Record: would you approve?
pnpm orch review --manual results/manual-reviews.json

# Aggregate metrics
pnpm orch aggregate results/ --output results/aggregated.json
```

### 4.8 Comparative Runs (Baselines)

Run 4 configurations:

**Config A: Single-agent (Baseline)**
- Executor only, no Critic
- Executor must achieve task without review

**Config B: Critic no revision cap**
- Executor + Critic
- Critic can request infinite revisions

**Config C: Critic with revision cap (3)**
- Executor + Critic
- Max 3 revisions, then escalate

**Config D: Full isolation (no context leakage)**
- Config C, plus strict proof no reasoning leaked to Critic

Store results separately:
```
results/
├── baseline-executor-only.json
├── critic-no-cap.json
├── critic-3-cap.json
├── critic-isolated.json
└── comparison.json  # Aggregated table
```

**Deliverables at end of Phase 4:**
- evals/metrics.ts computes all 6 metrics
- `pnpm orch run-all --golden` executes all 15 tasks
- `pnpm orch eval --golden` outputs MetricsResult JSON
- Manual review template + completed reviews
- All 4 baseline comparisons run and logged

---

## Phase 5: Documentation & Results (2-3 days)

**Goal:** Write RESULTS.md, NOTES.md, finalize DESIGN.md.

### 5.1 RESULTS.md (Main Deliverable)

Structure:
```markdown
# Results: Multi-Agent Orchestration Evaluation

## Executive Summary
[1-2 sentences on main finding]

## Comparative Metrics Table

| Metric | Single-Agent (A) | Critic No Cap (B) | Critic 3-Cap (C) | Critic Isolated (D) |
|--------|------------------|-------------------|------------------|---------------------|
| Task Success Rate | X% | X% | X% | X% |
| Critic Catch Rate | N/A | X% | X% | X% |
| Rubber-Stamp Rate | N/A | X% | X% | X% |
| Mean Revision Rounds | 0 | X | X | X |
| Redundant Round-Trip Ratio | N/A | X% | X% | X% |
| Tokens/Task | X | X | X | X |
| Wall-Clock/Task | Xms | Xms | Xms | Xms |

## Attribution & Findings

### Key Findings
1. [Main insight, e.g., "Critic without cap doesn't improve catch-rate but increases token cost 3x"]
2. [Secondary insight]
3. [Failure mode or surprise]

### Trade-offs
- [If Critic doesn't improve outcome, but improves process: say so]
- [If revision cap helps or hurts: quantify]
- [If context isolation changed behavior: attribute to what]

### Process Quality Insights
- [Sycophancy observations: did Critic rubber-stamp? In which configs?]
- [Critic independence: did fresh Reviews differ? By how much?]
- [Executor responsiveness: did revised Patches actually address Critic issues?]

## Detailed Trajectory Analysis

### Seeded Flaw Catch Rate (Config C)
[Drill into each seeded flaw]
```
Seeded Flaw 1 (off-by-one in email validation):
- Executor first attempt: Patch-A (incorrect)
- Critic review 1: [flags blocker? YES/NO] → issues: [list]
- Executor revision: Patch-B (did it fix the issue? YES/NO)
- Critic review 2: Approve
- Outcome: CAUGHT ✓

...
```

### Ambiguous Task Handling (Config C)
[How did Planner handle ambiguous tasks?]
```
Ambiguous Task 1 (Improve performance):
- Planner's interpretation: [what did it plan?]
- Did it ask for clarification? YES/NO
- If proceeded: were assumptions reasonable? SOMEWHAT/NOT REALLY
```

## Conclusion
[Summary of what multi-agent orchestration bought us, vs. single-agent]

## Appendix: Full Trajectories
[Link to JSON files or inline sample]
```

### 5.2 NOTES.md (Failure Mode Deep-dive)

```markdown
# Implementation Notes: Failure Modes & Mitigations

## 1. Sycophantic Critic (Did It Happen?)

### Observation
[Report rubber-stamp rate from Config B and C]

### Root Cause
[If high: prompt was too deferential? Model was too trusting?]

### Mitigation Applied
[Which specific prompt changes / measures helped?]

### Evidence
[Seeded flaws: did Critic catch them or approve?]
[Metrics: rubber-stamp rate]

---

## 2. Confabulated Blockers (Did It Happen?)

### Observation
[Did Critic invent issues? How often?]

### Root Cause
[Prompt framings that rewarded thoroughness over accuracy?]

### Mitigation Applied
[How did we discourage false positives?]

### Evidence
[Tasks with no seeded flaws: did Critic raise issues anyway?]
[Manual review: did human disagree with Critic's issues?]

---

## 3. Context Leakage (Did It Happen?)

### Observation
[Did Critic ever see Executor's reasoning? Proof?]

### Prevention Mechanism
[Code review: line X in context-assembler.ts ensures...]
[Test: CriticContextIsolation verifies no reasoning passed]

### Evidence
[Test results, assertion logs]

---

## Design Decisions That Worked
- [e.g., "Typed messages forced us to be explicit about boundaries"]
- [e.g., "Fresh Critic calls without history improved independence"]

## Design Decisions That Didn't
- [e.g., "Revision cap of 3 was too low / too high"]
- [e.g., "Severity levels (blocker/minor) weren't fine-grained enough"]

## Surprises
[What unexpected behavior emerged? Executor gave up too early? Critic was harsher on revision 2?]
```

### 5.3 DESIGN.md (Final)
Polish the version from Phase 0:
- Confirm all open questions were answered
- Add actual answers + trade-off analysis
- Update failure mode section with evidence from Phase 5

**Deliverables at end of Phase 5:**
- RESULTS.md (comparison table + attribution)
- NOTES.md (failure mode analysis)
- DESIGN.md (finalized, with evidence)

---

## Phase 6: Review Gate & Hardening (1-2 days)

**Goal:** Pass all review checks before merge.

### 6.1 Review Checklist (from brief)

- [ ] **Seeded Flaw Verification**
  - [ ] Plant a blocker (e.g., off-by-one)
  - [ ] Run: `pnpm orch run --task [seeded-task-id]`
  - [ ] Verify Critic's first Review has `verdict: 'revise'` + blocker-level issue
  - [ ] Verify issue location is correct (not generic "looks wrong")
  - [ ] Screenshot trajectory JSON for review

- [ ] **Revision Cap Enforcement**
  - [ ] Manually force Executor to resubmit unaddressed patch 3 times
  - [ ] Verify round 4 triggers escalation, not infinite loop
  - [ ] Verify `trajectory.escalation` is populated
  - [ ] Verify `trajectory.finalOutcome === 'escalated'`

- [ ] **Process Quality Spot-Check**
  - [ ] Read 3 full trajectories (different tasks)
  - [ ] For each, rate process quality independently:
    - Planner: made sense? Over-committed?
    - Executor: addressed Critic feedback or rubber-stamped approval?
    - Critic: inventing issues or catching real bugs?
  - [ ] Compare your read to automated process score
  - [ ] Are they aligned? If not, why?

- [ ] **Results Reproducibility**
  - [ ] Fresh clone, no cache
  - [ ] `pnpm install`, `pnpm orch run-all --golden`
  - [ ] `pnpm orch eval --golden`
  - [ ] Verify every number in RESULTS.md matches
  - [ ] Spot-check: same trajectory JSON files generated?

### 6.2 Common Review Issues
- Critic process isn't saved in trajectory → fix
- Revision loops don't increment correctly → fix
- Context assembler leaks Executor reasoning → fix
- RESULTS.md metrics don't reproduce → fix
- Manual process score and automated score disagree → investigate both

### 6.3 Edge Cases to Harden
- [ ] Empty repo (Planner should fail gracefully)
- [ ] Impossible task (e.g., "add to non-existent file") → escalate
- [ ] Critic approval with minor issues still pending → decide: is that OK?
- [ ] Executor gives up (says "cannot implement") → handle gracefully

---

## Project Timeline

| Phase | Task | Duration | Blocker? | Checkpoint |
|-------|------|----------|----------|------------|
| 0 | Design doc | 1-2d | YES | Approval gate |
| 1 | Infrastructure | 3-4d | - | `pnpm orch run` works |
| 2 | Agent implementation | 4-5d | - | LLM integration working |
| 3 | Golden tasks | 2-3d | - | 15 tasks defined, spot-checked |
| 4 | Metrics & baselines | 3-4d | - | 4 configs run, metrics computed |
| 5 | Documentation | 2-3d | - | RESULTS.md + NOTES.md done |
| 6 | Review & hardening | 1-2d | YES | All checks pass |

**Total:** ~17-24 days (assuming parallel work possible, else ~3-4 weeks)

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Sycophantic Critic ruins evaluation | HIGH | HIGH | Seeded flaws, manual spot-checks, metric tracking |
| Context leakage invalidates results | HIGH | HIGH | Strict test for context isolation, code review |
| Revision loop infinite | MEDIUM | HIGH | Hard cap + escalation, test enforcement |
| Ambiguous task grading subjective | MEDIUM | MEDIUM | Define "reasonable question" in advance |
| Metrics don't reproduce | MEDIUM | MEDIUM | Fresh-clone testing before review gate |
| Agent takes too long (token explosion) | MEDIUM | LOW | Monitor cost in Phase 2, abort if > budget |

---

## Success Criteria

- [ ] All 6 metrics computed and reported
- [ ] Critic catch-rate > 70% on seeded flaws
- [ ] Process trajectory evaluated separately from outcome
- [ ] No context leakage in Critic evaluation
- [ ] Revision cap enforced, escalation works
- [ ] RESULTS.md compares 4 configurations with attribution
- [ ] Review gate passes all 4 checks
- [ ] Metrics reproducible from fresh clone

---

## What This Is NOT

- A production system (no persistence, queues, monitoring)
- A multi-machine deployment (all in-process)
- A fine-tuning exercise (use out-of-the-box qwen2.5)
- A scaling proof (4 agents max, 15 tasks)
- A comparison to other frameworks (this is ground-up)

This is a **focused study of agent disagreement dynamics and trajectory-level evaluation.**

