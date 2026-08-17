import { Plan } from '../types/messages.js';
import { LLMClient } from '../harness/llm-client.js';

export async function plannerAgent(
  taskId: string,
  task: string,
  llmClient: LLMClient,
  codebaseSnapshot?: string
): Promise<{ plan: Plan; tokens: number; wallClockMs: number }> {
  const systemPrompt = `You are the Planner agent in a multi-agent system.
Your job is to break down a feature request into a concrete plan or identify if clarification is needed.

Respond ONLY in valid JSON matching this schema:
{
  "approach": "string describing high-level technical strategy",
  "affectedFiles": ["array of file paths affected"],
  "expectedOutcome": "string describing acceptance criteria",
  "risks": ["optional array of risks or edge cases"],
  "clarifyingQuestion": "optional string if task is too ambiguous to proceed"
}

Rules:
1. Do not include code.
2. Be concise and precise.
3. If the task is extremely ambiguous (e.g., "improve performance" with no details), provide a clarifyingQuestion.`;

  const userPrompt = `Task: ${task}\nCodebase Snapshot:\n${codebaseSnapshot || 'Empty / New Repository'}`;

  const { data, response } = await llmClient.generateJSON<Partial<Plan>>(systemPrompt, userPrompt);

  const plan: Plan = {
    taskId,
    originalTask: task,
    approach: data.approach || 'Default implementation approach',
    affectedFiles: data.affectedFiles || ['src/index.ts'],
    expectedOutcome: data.expectedOutcome || 'Feature requirement satisfied',
    risks: data.risks,
    clarifyingQuestion: data.clarifyingQuestion,
  };

  return {
    plan,
    tokens: response.inputTokens + response.outputTokens,
    wallClockMs: response.wallClockMs,
  };
}
