import * as fs from 'fs';
import * as path from 'path';
import { Plan, Patch, Review, EscalationResult, Trajectory } from '../types/messages.js';
import { MessageBus } from '../bus/message-bus.js';
import { ContextAssembler } from './context-assembler.js';
import { LLMClient } from './llm-client.js';
import { plannerAgent } from '../agents/planner.js';
import { executorAgent } from '../agents/executor.js';
import { criticAgent } from '../agents/critic.js';

export interface OrchestratorOptions {
  singleAgentOnly?: boolean;           // Config A
  maxRevisionRounds?: number;          // Config C/D default 3, Config B Infinity
  strictContextIsolation?: boolean;    // Config D & C true, Config B false/true
  seededFlaw?: string;                 // For seeded flaw tasks
  category?: 'well-specified' | 'seeded-flaw' | 'ambiguous';
}

export class Orchestrator {
  private bus: MessageBus;
  private llmClient: LLMClient;

  constructor(bus: MessageBus, llmClient: LLMClient) {
    this.bus = bus;
    this.llmClient = llmClient;
  }

  public async runTask(
    taskId: string,
    task: string,
    options: OrchestratorOptions = {}
  ): Promise<Trajectory> {
    const startTime = Date.now();
    let totalTokens = 0;

    const singleAgentOnly = options.singleAgentOnly ?? false;
    const maxRevisionRounds = options.maxRevisionRounds ?? 3;
    const strictContextIsolation = options.strictContextIsolation ?? true;
    const category = options.category ?? 'well-specified';

    const fixturePathCandidate1 = path.resolve(process.cwd(), 'packages/orchestrator/tests/fixtures/test-repo');
    const fixturePathCandidate2 = path.resolve(process.cwd(), 'tests/fixtures/test-repo');
    const repoFixturePath = fs.existsSync(fixturePathCandidate1) ? fixturePathCandidate1 : fixturePathCandidate2;
    const codebaseSnapshot = ContextAssembler.readRepoSnapshot(repoFixturePath);

    const patches: Patch[] = [];
    const reviews: Review[] = [];
    let escalationResult: EscalationResult | undefined;
    let finalOutcome: 'approved' | 'escalated' | 'clarification-requested' = 'approved';

    // 1. Planner Phase
    const plannerRes = await plannerAgent(taskId, task, this.llmClient, codebaseSnapshot);
    const plan: Plan = plannerRes.plan;
    totalTokens += plannerRes.tokens;
    await this.bus.publish('plan:created', plan);

    // If ambiguous task triggered clarification question
    if (plan.clarifyingQuestion && category === 'ambiguous') {
      return {
        taskId,
        category,
        task,
        plan,
        patches: [],
        reviews: [],
        finalOutcome: 'clarification-requested',
        totalTurns: 1,
        totalTokens,
        wallClockMs: Date.now() - startTime,
      };
    }

    // 2. Initial Executor Attempt
    const executorRes = await executorAgent(
      taskId,
      plan,
      this.llmClient,
      undefined,
      undefined,
      options.seededFlaw
    );
    let currentPatch: Patch = executorRes.patch;
    patches.push(currentPatch);
    totalTokens += executorRes.tokens;
    await this.bus.publish('patch:submitted', currentPatch);

    // If Single Agent Baseline (Config A)
    if (singleAgentOnly) {
      return {
        taskId,
        category,
        task,
        plan,
        patches,
        reviews,
        finalOutcome: 'approved',
        totalTurns: 1,
        totalTokens,
        wallClockMs: Date.now() - startTime,
      };
    }

    // 3. Revision Loop Engine
    let turnsUsed = 0;
    while (turnsUsed < maxRevisionRounds) {
      turnsUsed++;

      // Assemble Critic Context with strict isolation
      const criticContext = ContextAssembler.getCriticContext(task, currentPatch, strictContextIsolation);

      // Call Critic Agent
      const criticRes = await criticAgent(`patch-${turnsUsed}`, criticContext, turnsUsed, this.llmClient);
      const review: Review = criticRes.review;
      reviews.push(review);
      totalTokens += criticRes.tokens;
      await this.bus.publish('review:completed', review);

      if (review.verdict === 'approve') {
        finalOutcome = 'approved';
        break;
      }

      // If Critic requests revision
      if (turnsUsed >= maxRevisionRounds) {
        // Exceeded revision cap -> ESCALATION
        finalOutcome = 'escalated';
        escalationResult = {
          taskId,
          reason: 'max-revisions-hit',
          lastReview: review,
          lastPatch: currentPatch,
          criticHistory: [...reviews],
          recommendation: `Revision cap of ${maxRevisionRounds} reached. Escalating blocker issues for human review: ${review.issues.map((i) => i.note).join('; ')}`,
        };
        await this.bus.publish('escalation:triggered', escalationResult);
        break;
      }

      // Re-prompt Executor with Critic feedback
      await this.bus.publish('revision:requested', {
        taskId,
        patchId: currentPatch.planId,
        review,
        maxRevisionRounds,
        roundsRemaining: maxRevisionRounds - turnsUsed,
      });

      const nextExecutorRes = await executorAgent(taskId, plan, this.llmClient, currentPatch, review);
      currentPatch = nextExecutorRes.patch;
      patches.push(currentPatch);
      totalTokens += nextExecutorRes.tokens;
      await this.bus.publish('patch:submitted', currentPatch);
    }

    const wallClockMs = Date.now() - startTime;

    return {
      taskId,
      category,
      task,
      plan,
      patches,
      reviews,
      escalation: escalationResult,
      finalOutcome,
      totalTurns: turnsUsed || 1,
      totalTokens,
      wallClockMs,
    };
  }
}
