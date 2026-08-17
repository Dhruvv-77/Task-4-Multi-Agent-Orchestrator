import { describe, it, expect } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { MessageBus } from '../bus/message-bus.js';
import { LLMClient } from './llm-client.js';
import { ContextAssembler } from './context-assembler.js';
import { Patch } from '../types/messages.js';

describe('Orchestrator Harness', () => {
  const llmClient = new LLMClient({ mockMode: true });

  it('executes happy path with single-agent baseline (Config A)', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus, llmClient);

    const trajectory = await orchestrator.runTask('task-1', 'Add logger to userService', {
      singleAgentOnly: true,
    });

    expect(trajectory.finalOutcome).toBe('approved');
    expect(trajectory.patches.length).toBe(1);
    expect(trajectory.reviews.length).toBe(0);
    expect(bus.getHistory().length).toBeGreaterThanOrEqual(2);
  });

  it('runs multi-agent revision loop and approves when critic approves', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus, llmClient);

    const trajectory = await orchestrator.runTask('task-2', 'Implement authentication route', {
      maxRevisionRounds: 3,
    });

    expect(trajectory.plan).toBeDefined();
    expect(trajectory.patches.length).toBeGreaterThan(0);
    expect(trajectory.totalTokens).toBeGreaterThan(0);
  });

  it('Config C (non-isolated) and Config D (isolated) produce different Critic contexts', () => {
    const patch: Patch = {
      taskId: 't-1',
      planId: 'p-1',
      filePath: 'src/auth.ts',
      code: 'function login() { return true; }',
      reasoning: 'I chose this implementation because I believe security is optimal here.',
    };

    const leakyContext = ContextAssembler.getCriticContext('Implement login', patch, false);
    const isolatedContext = ContextAssembler.getCriticContext('Implement login', patch, true);

    expect(leakyContext.patchCode).toContain(patch.reasoning);
    expect(isolatedContext.patchCode).not.toContain(patch.reasoning);
    expect(isolatedContext.patchCode).toBe(patch.code);
  });
});
