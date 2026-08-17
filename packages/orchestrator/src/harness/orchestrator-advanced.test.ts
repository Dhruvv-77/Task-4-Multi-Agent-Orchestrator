import { describe, it, expect } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { MessageBus } from '../bus/message-bus.js';
import { LLMClient } from './llm-client.js';

describe('Orchestrator Advanced & Edge Case Enforcement', () => {
  const llmClient = new LLMClient({ mockMode: true });

  it('triggers escalation when max revision cap is reached', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus, llmClient);

    // Force 1 revision round cap
    const trajectory = await orchestrator.runTask('task-escalate', 'Complex system feature with seeded flaw', {
      maxRevisionRounds: 1,
      seededFlaw: 'Off-by-one seeded flaw in string validation',
    });

    expect(trajectory.finalOutcome).toBe('escalated');
    expect(trajectory.escalation).toBeDefined();
    expect(trajectory.escalation?.reason).toBe('max-revisions-hit');
  });

  it('handles ambiguous task by asking clarifying question', async () => {
    const bus = new MessageBus();

    // Mock planner returning clarifying question for ambiguous task
    const mockClient = new LLMClient({ mockMode: true });
    const orchestrator = new Orchestrator(bus, mockClient);

    const trajectory = await orchestrator.runTask('ambiguous-1', 'Improve performance', {
      category: 'ambiguous',
    });

    expect(trajectory.plan?.clarifyingQuestion).toBeDefined();
    expect(trajectory.finalOutcome).toBe('clarification-requested');
  });
});
