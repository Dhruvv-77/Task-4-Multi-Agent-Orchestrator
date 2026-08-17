import { describe, it, expect } from 'vitest';
import { plannerAgent } from './planner.js';
import { executorAgent } from './executor.js';
import { criticAgent } from './critic.js';
import { LLMClient } from '../harness/llm-client.js';
import { ContextAssembler } from '../harness/context-assembler.js';

describe('Agent Implementations (Mock Mode)', () => {
  const llmClient = new LLMClient({ mockMode: true });

  it('plannerAgent generates structured plan', async () => {
    const result = await plannerAgent('task-1', 'Add rate limiting', llmClient);
    expect(result.plan.taskId).toBe('task-1');
    expect(result.plan.approach).toBeDefined();
    expect(result.tokens).toBeGreaterThan(0);
  });

  it('executorAgent generates patch with reasoning', async () => {
    const { plan } = await plannerAgent('task-1', 'Add rate limiting', llmClient);
    const result = await executorAgent('task-1', plan, llmClient);

    expect(result.patch.code).toBeDefined();
    expect(result.patch.reasoning).toBeDefined();
  });

  it('criticAgent evaluates patch and issues verdict', async () => {
    const { plan } = await plannerAgent('task-1', 'Add rate limiting', llmClient);
    const { patch } = await executorAgent('task-1', plan, llmClient);

    const criticContext = ContextAssembler.getCriticContext('Add rate limiting', patch, true);
    const result = await criticAgent('patch-1', criticContext, 1, llmClient);

    expect(result.review.verdict).toBeDefined();
    expect(result.review.issues).toBeDefined();
  });
});
