import { describe, it, expect } from 'vitest';
import { ContextAssembler } from './context-assembler.js';
import { Patch } from '../types/messages.js';

describe('ContextAssembler', () => {
  it('strips Executor reasoning from Critic context when strict isolation is enabled', () => {
    const patch: Patch = {
      taskId: 't-1',
      planId: 'p-1',
      filePath: 'src/auth.ts',
      code: 'function login() { return true; }',
      reasoning: 'I chose this implementation because I believe security is optimal here.',
    };

    const criticContext = ContextAssembler.getCriticContext(
      'Implement login function',
      patch,
      true
    );

    expect(criticContext.patchCode).not.toContain(patch.reasoning);
    expect(criticContext.patchCode).toBe(patch.code);
    expect(criticContext.originalTask).toBe('Implement login function');
  });

  it('includes reasoning when strict isolation is disabled (for comparative testing)', () => {
    const patch: Patch = {
      taskId: 't-1',
      planId: 'p-1',
      filePath: 'src/auth.ts',
      code: 'function login() { return true; }',
      reasoning: 'I chose this implementation because I believe security is optimal here.',
    };

    const criticContext = ContextAssembler.getCriticContext(
      'Implement login function',
      patch,
      false
    );

    expect(criticContext.patchCode).toContain(patch.reasoning);
  });

  it('reads codebase snapshot from test-repo fixture directory', () => {
    const fixturePath = 'tests/fixtures/test-repo';
    const snapshot = ContextAssembler.readRepoSnapshot(fixturePath);

    expect(snapshot).toContain('Repository Root: test-repo');
    expect(snapshot).toContain('package.json');
  });
});
