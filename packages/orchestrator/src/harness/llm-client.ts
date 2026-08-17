export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  wallClockMs: number;
}

export interface LLMClientConfig {
  baseUrl?: string;
  model?: string;
  mockMode?: boolean;
}

export class LLMClient {
  private baseUrl: string;
  private model: string;
  private mockMode: boolean;

  constructor(config?: LLMClientConfig) {
    this.baseUrl = config?.baseUrl || 'http://127.0.0.1:11434';
    this.model = config?.model || 'qwen2.5:7b-instruct';
    this.mockMode = config?.mockMode || false;
  }

  public async generateJSON<T>(systemPrompt: string, userPrompt: string): Promise<{ data: T; response: LLMResponse }> {
    const startTime = Date.now();

    if (this.mockMode) {
      return this.mockGenerateJSON<T>(systemPrompt, userPrompt);
    }

    const maxAttempts = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            keep_alive: '30m',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            format: 'json',
            stream: false,
            options: {
              temperature: attempt === 1 ? 0.2 : 0.3,
              num_predict: 4096,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama HTTP Error: ${response.status} ${response.statusText}`);
        }

        const json = await response.json();  
        const wallClockMs = Date.now() - startTime;

        const content = json.message?.content || '';
        const inputTokens = json.prompt_eval_count || Math.ceil((systemPrompt.length + userPrompt.length) / 4);
        const outputTokens = json.eval_count || Math.ceil(content.length / 4);

        // Clean and safely parse JSON from LLM output
        const data = this.parseLLMJson<T>(content);

        return {
          data,
          response: {
            content,
            inputTokens,
            outputTokens,
            wallClockMs,
          },
        };
      } catch (err) {
        lastError = err as Error;
        console.warn(`[LLMClient] Attempt ${attempt}/${maxAttempts} failed: ${(err as Error).message}`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        }
      }
    }

    throw lastError || new Error('LLM generation failed after retries.');
  }

  private parseLLMJson<T>(content: string): T {
    let cleaned = content.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

    // Drop any commentary before the JSON (works even when truncated — no closing brace yet)
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1) {
      cleaned = cleaned.slice(firstBrace, lastBrace > firstBrace ? lastBrace + 1 : cleaned.length);
    }

    // Repair attempt 1: Fix unescaped control characters/newlines inside JSON string values (quote-aware, keeps structural whitespace intact)
    const sanitized = LLMClient.escapeControlCharsInStrings(cleaned);

    // Repair attempt 2: Strip trailing commas (e.g. "a": 1,]  or  },)
    const noTrailingCommas = sanitized.replace(/,(\s*[}\]])/g, '$1');

    // Repair attempt 3: Insert missing commas between array elements (quote-aware)
    const withCommas = LLMClient.repairMissingCommas(sanitized);

    // Repair attempt 4: Truncation — append missing closing brackets
    const closed = LLMClient.closeUnterminated(cleaned);

    const candidates: string[] = [cleaned, closed, sanitized, noTrailingCommas, withCommas];
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // try next repair
      }
    }

    // Fallback: Regex extraction for critical fields if JSON structure is malformed
    const obj: any = {};
    const filePathMatch = content.match(/"filePath"\s*:\s*"([^"]+)"/);
    if (filePathMatch) obj.filePath = filePathMatch[1];

    const reasoningMatch = content.match(/"reasoning"\s*:\s*"([^"]+)"/);
    if (reasoningMatch) obj.reasoning = reasoningMatch[1];

    const codeMatch = content.match(/"code"\s*:\s*"([\s\S]*)"/);
    if (codeMatch) obj.code = codeMatch[1];

    const verdictMatch = content.match(/"verdict"\s*:\s*"(approve|revise)"/);
    if (verdictMatch) obj.verdict = verdictMatch[1];

    if (Object.keys(obj).length > 0) {
      return obj as T;
    }

    throw new SyntaxError(
      `Failed to parse LLM JSON response after repair attempts.\nRaw output:\n${content.slice(0, 2000)}`
    );
  }

  private static repairMissingCommas(json: string): string {
    let out = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < json.length; i++) {
      const ch = json[i];
      out += ch;

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      // Skip whitespace to find the next structural char
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) j++;
      const next = json[j];
      // Missing comma between elements: } {  or ] {  or } [  or ] [
      if ((ch === '}' || ch === ']') && (next === '{' || next === '[')) {
        out += ',';
      }
    }
    return out;
  }

  private static closeUnterminated(json: string): string {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < json.length; i++) {
      const ch = json[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') {
        const top = stack[stack.length - 1];
        if ((ch === '}' && top === '{') || (ch === ']' && top === '[')) stack.pop();
      }
    }

    let closing = '';
    for (let i = stack.length - 1; i >= 0; i--) closing += stack[i] === '{' ? '}' : ']';
    return json + closing;
  }

  private static escapeControlCharsInStrings(json: string): string {
    let out = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < json.length; i++) {
      const ch = json[i];
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = !inString; out += ch; continue; }
      if (inString) {
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\r') { out += '\\r'; continue; }
        if (ch === '\t') { out += '\\t'; continue; }
        if (ch.charCodeAt(0) < 32 || (ch.charCodeAt(0) >= 127 && ch.charCodeAt(0) <= 159)) continue;
      }
      out += ch;
    }
    return out;
  }

  private mockGenerateJSON<T>(systemPrompt: string, userPrompt: string): { data: T; response: LLMResponse } {
    const wallClockMs = 50;
    const inputTokens = 150;
    const outputTokens = 100;

    let data: any = {};
    if (systemPrompt.includes('Planner')) {
      if (userPrompt.toLowerCase().includes('ambiguous') || userPrompt.toLowerCase().includes('improve performance')) {
        data = {
          approach: 'Need clarification before proceeding',
          affectedFiles: [],
          expectedOutcome: 'Clarification obtained',
          clarifyingQuestion: 'Which specific endpoint requires optimization?',
        };
      } else {
        data = {
          approach: 'Implement feature using structured modules',
          affectedFiles: ['src/feature.ts'],
          expectedOutcome: 'Requirement fulfilled with clean tests',
        };
      }
    } else if (systemPrompt.includes('Executor')) {
      data = {
        filePath: 'src/feature.ts',
        code: '// Proposed implementation code patch\nexport function run() { return true; }',
        reasoning: 'Self-reasoning: Used standard modular structure.',
      };
    } else if (systemPrompt.includes('reviewer')) {
      if (userPrompt.toLowerCase().includes('flaw') || userPrompt.toLowerCase().includes('seeded')) {
        data = {
          verdict: 'revise',
          issues: [
            {
              severity: 'blocker',
              note: 'Seeded flaw detected: missing validation logic',
              location: 'src/feature.ts:12',
            },
          ],
          confidence: 0.95,
        };
      } else {
        data = {
          verdict: 'approve',
          issues: [],
          confidence: 0.95,
        };
      }
    }

    return {
      data: data as T,
      response: {
        content: JSON.stringify(data),
        inputTokens,
        outputTokens,
        wallClockMs,
      },
    };
  }
}
