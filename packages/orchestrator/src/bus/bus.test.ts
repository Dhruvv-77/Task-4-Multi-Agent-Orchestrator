import { describe, it, expect, vi } from 'vitest';
import { MessageBus } from './message-bus.js';
import { Plan, Review } from '../types/messages.js';

describe('MessageBus', () => {
  it('publishes and subscribes to events with correct payloads', async () => {
    const bus = new MessageBus();
    const handler = vi.fn();

    bus.subscribe('plan:created', handler);

    const testPlan: Plan = {
      taskId: 'task-1',
      originalTask: 'Add feature X',
      approach: 'Direct implementation',
      affectedFiles: ['src/feature.ts'],
      expectedOutcome: 'Tests pass',
    };

    await bus.publish('plan:created', testPlan);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(testPlan);
  });

  it('maintains event history in order', async () => {
    const bus = new MessageBus();

    const plan: Plan = {
      taskId: 'task-1',
      originalTask: 'Task 1',
      approach: 'Approach',
      affectedFiles: [],
      expectedOutcome: 'Success',
    };

    const review: Review = {
      patchId: 'patch-1',
      verdict: 'approve',
      issues: [],
      turnsUsed: 1,
    };

    await bus.publish('plan:created', plan);
    await bus.publish('review:completed', review);

    const history = bus.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].type).toBe('plan:created');
    expect(history[1].type).toBe('review:completed');
  });

  it('allows unsubscribing from events', async () => {
    const bus = new MessageBus();
    const handler = vi.fn();

    const unsubscribe = bus.subscribe('plan:created', handler);
    unsubscribe();

    await bus.publish('plan:created', {
      taskId: 't-1',
      originalTask: 'Task',
      approach: 'Approach',
      affectedFiles: [],
      expectedOutcome: 'Done',
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
