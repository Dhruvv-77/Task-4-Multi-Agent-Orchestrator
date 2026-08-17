import { Review, CriticIssue } from '../types/messages.js';
import { LLMClient } from '../harness/llm-client.js';
import { CriticContext } from '../harness/context-assembler.js';

export async function criticAgent(
  patchId: string,
  context: CriticContext,
  turnsUsed: number,
  llmClient: LLMClient
): Promise<{ review: Review; tokens: number; wallClockMs: number }> {
  const systemPrompt = `You are an independent, highly vigilant code reviewer.
Your sole job is to evaluate proposed code against the original task requirements and catch bugs or logical flaws.

CRITICAL INSTRUCTIONS FOR ANTI-SYCOPHANCY:
1. You do NOT see the executor's reasoning or self-justifications. You judge ONLY the code itself.
2. Be rigorous and independent. Do NOT rubber-stamp code or assume the author is competent.
3. For every issue found:
   - Use severity "blocker" ONLY if the code fails requirement, has off-by-one errors, missing logic, crashes, or unhandled exceptions.
   - Use severity "minor" for style, minor optimizations, or optional enhancements.
4. If there is at least one "blocker" issue, set verdict to "revise".
5. Set verdict to "approve" ONLY if all task requirements are satisfied without blockers.

Respond ONLY in valid JSON matching this schema:
{
  "verdict": "approve" | "revise",
  "issues": [
    {
      "severity": "blocker" | "minor",
      "note": "detailed description of the bug or issue",
      "location": "optional line number or function name"
    }
  ],
  "confidence": 0.9
}`;

  const userPrompt = `Original Task: ${context.originalTask}\nTarget File: ${context.filePath}\nProposed Code Patch:\n\`\`\`\n${context.patchCode}\n\`\`\``;

  const { data, response } = await llmClient.generateJSON<Partial<Review>>(systemPrompt, userPrompt);

  const issues: CriticIssue[] = (data.issues || []).map((i) => ({
    severity: i.severity === 'blocker' ? 'blocker' : 'minor',
    note: i.note || 'Unspecified code issue',
    location: i.location,
  }));

  const hasBlocker = issues.some((i) => i.severity === 'blocker');
  const verdict: 'approve' | 'revise' = data.verdict === 'approve' && !hasBlocker ? 'approve' : 'revise';

  const review: Review = {
    patchId,
    verdict,
    issues,
    turnsUsed,
    confidence: data.confidence || 0.9,
  };

  return {
    review,
    tokens: response.inputTokens + response.outputTokens,
    wallClockMs: response.wallClockMs,
  };
}
