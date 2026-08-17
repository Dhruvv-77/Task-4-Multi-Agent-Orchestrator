import * as fs from 'fs';
import * as path from 'path';
import { Plan, Patch } from '../types/messages.js';

export interface PlannerContext {
  task: string;
  codebaseSnapshot?: string;
}

export interface ExecutorContext {
  task: string;
  plan: Plan;
  codebaseSnapshot?: string;
}

export interface CriticContext {
  originalTask: string;
  patchCode: string;
  filePath: string;
}

export class ContextAssembler {
  public static readRepoSnapshot(repoPath: string): string {
    if (!fs.existsSync(repoPath)) {
      return 'Repository fixture not found.';
    }

    const filesToRead = ['package.json', 'README.md', 'DESIGN.md'];
    const snapshotParts: string[] = [`Repository Root: ${path.basename(repoPath)}` ];

    for (const file of filesToRead) {
      const fullPath = path.join(repoPath, file);
      if (fs.existsSync(fullPath)) {
        snapshotParts.push(`--- File: ${file} ---\n${fs.readFileSync(fullPath, 'utf-8').slice(0, 1000)}`);
      }
    }

    return snapshotParts.join('\n\n');
  }
  public static getPlannerContext(task: string, codebaseSnapshot?: string): PlannerContext {
    return {
      task,
      codebaseSnapshot,
    };
  }

  public static getExecutorContext(
    task: string,
    plan: Plan,
    codebaseSnapshot?: string
  ): ExecutorContext {
    return {
      task,
      plan,
      codebaseSnapshot,
    };
  }

  public static getCriticContext(
    task: string,
    patch: Patch,
    enforceStrictIsolation: boolean = true
  ): CriticContext {
    if (enforceStrictIsolation) {
      // STRICT ISOLATION: Strip out patch.reasoning and internal thoughts!
      return {
        originalTask: task,
        patchCode: patch.code,
        filePath: patch.filePath,
      };
    } else {
      // Non-isolated config (for comparison testing, e.g. includes reasoning)
      return {
        originalTask: task,
        patchCode: `// Reasoning: ${patch.reasoning}\n${patch.code}`,
        filePath: patch.filePath,
      };
    }
  }
}
