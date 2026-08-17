import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { Orchestrator, OrchestratorOptions } from '../harness/orchestrator.js';
import { MessageBus } from '../bus/message-bus.js';
import { LLMClient } from '../harness/llm-client.js';
import { Trajectory } from '../types/messages.js';
import { computeMetrics, MetricsResult } from '../../../../evals/metrics.js';

const program = new Command();

program
  .name('orch')
  .description('Multi-Agent Orchestration & Trajectory Evaluation Framework CLI')
  .version('1.0.0');

function getRootPath(...subPaths: string[]): string {
  const currentCwd = process.cwd();
  if (fs.existsSync(path.resolve(currentCwd, 'evals'))) {
    return path.resolve(currentCwd, ...subPaths);
  } else {
    return path.resolve(currentCwd, '../../', ...subPaths);
  }
}

function wordWrap(text: string, maxWidth: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  const words = text.replace(/\r\n/g, '\n').split('\n');

  for (const paragraph of words) {
    if (paragraph.length <= maxWidth) {
      lines.push(paragraph);
    } else {
      let current = '';
      const tokens = paragraph.split(' ');
      for (const token of tokens) {
        if ((current + (current ? ' ' : '') + token).length > maxWidth) {
          if (current) lines.push(current);
          current = token;
        } else {
          current += (current ? ' ' : '') + token;
        }
      }
      if (current) lines.push(current);
    }
  }
  return lines;
}

function printCard(title: string, rawContent: { label?: string; text: string }[], cardWidth: number = 96) {
  const innerWidth = cardWidth - 6; // 2 border chars + 4 padding spaces
  const border = '─'.repeat(cardWidth - 2);

  console.log(`\n┌─ ${title} ${'─'.repeat(Math.max(0, cardWidth - 5 - title.length))}┐`);

  for (const item of rawContent) {
    if (item.label) {
      const header = `● ${item.label}:`;
      console.log(`│  ${header.padEnd(innerWidth)}  │`);
      const wrappedText = wordWrap(item.text, innerWidth - 2);
      for (const line of wrappedText) {
        console.log(`│    ${line.padEnd(innerWidth - 2)}  │`);
      }
    } else {
      const wrappedText = wordWrap(item.text, innerWidth);
      for (const line of wrappedText) {
        console.log(`│  ${line.padEnd(innerWidth)}  │`);
      }
    }
  }

  console.log(`└${border}┘`);
}

// 1. Single Task Command
program
  .command('run')
  .description('Run a single task targeting the Task 3 repository codebase')
  .option('-t, --task <string>', 'Task description', 'Add rate limiting to MCP server tool invocations in packages/agent/src/mcp/server.ts')
  .option('-m, --mock', 'Use mock mode instead of live Ollama', false)
  .option('-c, --config <string>', 'Configuration: A (single-agent), B (no cap), C (cap=3), D (strict isolated)', 'C')
  .action(async (options) => {
    const bus = new MessageBus();
    const llmClient = new LLMClient({ mockMode: options.mock });
    const orchestrator = new Orchestrator(bus, llmClient);

    let orchOpts: OrchestratorOptions = {};
    if (options.config === 'A') {
      orchOpts = { singleAgentOnly: true };
    } else if (options.config === 'B') {
      orchOpts = { maxRevisionRounds: 10, strictContextIsolation: false };
    } else if (options.config === 'C') {
      orchOpts = { maxRevisionRounds: 3, strictContextIsolation: false };
    } else if (options.config === 'D') {
      orchOpts = { maxRevisionRounds: 3, strictContextIsolation: true };
    }

    console.clear();
    console.log('\n====================================================================================================');
    console.log('                 🤖 MULTI-AGENT ORCHESTRATION TRAJECTORY RUNNER                                    ');
    console.log('====================================================================================================');
    console.log(`🎯 Task: ${options.task}`);
    console.log(`⚙️ Config: Config ${options.config} | Mode: ${options.mock ? 'Mock Mode' : 'Live Ollama'}`);
    console.log('⏳ Running Planner → Executor → Critic pipeline...\n');

    const trajectory = await orchestrator.runTask(`task-${Date.now()}`, options.task, orchOpts);

    // Render Plan Card
    if (trajectory.plan) {
      printCard('🧠 PLANNER STAGE', [
        { label: 'Approach Strategy', text: trajectory.plan.approach },
        { label: 'Affected Files', text: trajectory.plan.affectedFiles.join(', ') || 'N/A' },
        { label: 'Expected Outcome', text: trajectory.plan.expectedOutcome },
      ]);
    }

    // Render Last Patch Card
    const lastPatch = trajectory.patches[trajectory.patches.length - 1];
    if (lastPatch) {
      printCard('⚡ EXECUTOR CODE PATCH PROPOSAL', [
        { label: 'Target File Path', text: lastPatch.filePath },
        { label: 'Full Reasoning', text: lastPatch.reasoning },
        { label: 'Full Code Patch Output', text: lastPatch.code },
      ]);
    }

    // Render Last Review Card
    const lastReview = trajectory.reviews[trajectory.reviews.length - 1];
    if (lastReview) {
      const statusIcon = lastReview.verdict === 'approve' ? '✅ APPROVED' : '⚠️ REVISION REQUIRED';
      const issueSummary = lastReview.issues.length > 0
        ? lastReview.issues.map((i, idx) => `${idx + 1}. [${i.severity.toUpperCase()}] ${i.note}${i.location ? ` (${i.location})` : ''}`).join('\n')
        : 'No blocker issues detected.';

      printCard('🔍 CRITIC REVIEW STAGE', [
        { label: 'Verdict', text: statusIcon },
        { label: 'Revision Turns Used', text: `${lastReview.turnsUsed}` },
        { label: 'Reviewer Issues', text: issueSummary },
      ]);
    }

    // Render Final Outcome Card
    const outcomeBadge = trajectory.finalOutcome === 'approved' ? '✅ APPROVED' : '🚨 ESCALATED (Revision Cap Reached)';
    printCard('📊 FINAL TRAJECTORY METRICS & RECORD', [
      { label: 'Final Outcome Status', text: outcomeBadge },
      { label: 'Total Revision Rounds', text: `${trajectory.totalTurns}` },
      { label: 'Total Tokens Consumed', text: `${trajectory.totalTokens}` },
      { label: 'Wall Clock Time', text: `${trajectory.wallClockMs}ms` },
    ]);

    const resultsDir = getRootPath('results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    const outputPath = path.join(resultsDir, `single-task-trajectory.json`);
    fs.writeFileSync(outputPath, JSON.stringify(trajectory, null, 2));

    console.log(`\n✨ Saved full trajectory record to: ${outputPath}\n`);
  });

// 2. Run All Golden Tasks Benchmark Command
program
  .command('run-all')
  .description('Run all golden evaluation tasks across Configurations A, B, C, D')
  .option('--golden', 'Use golden dataset file', true)
  .option('-m, --mock', 'Use mock LLM mode for local benchmarking test', false)
  .action(async (options) => {
    const goldenFile = getRootPath('evals/golden-orchestrator.jsonl');
    if (!fs.existsSync(goldenFile)) {
      console.error(`Golden dataset not found at ${goldenFile}`);
      process.exit(1);
    }

    const lines = fs.readFileSync(goldenFile, 'utf-8').split('\n').filter((l) => l.trim().length > 0);
    const goldenTasks = lines.map((l) => JSON.parse(l));

    console.log(`\n🚀 [ORCH] Benchmark execution started for ${goldenTasks.length} golden tasks on Task 3 repository codebase...\n`);

    const llmClient = new LLMClient({ mockMode: options.mock });
    const resultsDir = getRootPath('results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const configs: { name: string; opts: OrchestratorOptions }[] = [
      { name: 'Config A (Single-Agent Baseline)', opts: { singleAgentOnly: true } },
      { name: 'Config B (Critic No Cap)', opts: { maxRevisionRounds: 10, strictContextIsolation: false } },
      { name: 'Config C (Critic 3-Cap)', opts: { maxRevisionRounds: 3, strictContextIsolation: false } },
      { name: 'Config D (Critic Isolated)', opts: { maxRevisionRounds: 3, strictContextIsolation: true } },
    ];

    const allMetrics: MetricsResult[] = [];

    for (const cfg of configs) {
      console.log(`⏳ Evaluating ${cfg.name}...`);
      const trajectories: Trajectory[] = [];
      let taskFailures = 0;

      for (const t of goldenTasks) {
        try {
          const bus = new MessageBus();
          const orchestrator = new Orchestrator(bus, llmClient);

          const trajectory = await orchestrator.runTask(t.id, t.task, {
            ...cfg.opts,
            category: t.category,
            seededFlaw: t.seededFlaw,
          });

          trajectories.push(trajectory);
        } catch (err) {
          taskFailures++;
          console.warn(`[TASK FAILED] ${cfg.name} / ${t.id}: ${(err as Error).message}`);
        }
      }

      if (taskFailures > 0) {
        console.warn(`⚠️ ${taskFailures} of ${goldenTasks.length} tasks failed in ${cfg.name} (excluded from metrics).`);
      }

      const metrics = computeMetrics(cfg.name, trajectories);
      allMetrics.push(metrics);

      fs.writeFileSync(
        path.join(resultsDir, `trajectories-${cfg.name.replace(/\s+/g, '-').toLowerCase()}.json`),
        JSON.stringify(trajectories, null, 2)
      );
    }

    const comparisonPath = path.join(resultsDir, 'comparison.json');
    fs.writeFileSync(comparisonPath, JSON.stringify(allMetrics, null, 2));
    fs.writeFileSync(path.join(resultsDir, 'baseline.json'), JSON.stringify(allMetrics[0], null, 2));

    console.log(`\n✅ Benchmark completed successfully! Metrics summary saved to ${comparisonPath}\n`);
  });

// 3. Eval Command
program
  .command('eval')
  .description('Compute evaluation metrics from benchmark results and generate RESULTS.md table')
  .option('--golden', 'Read from results directory', true)
  .option('--compare <string>', 'Compare results against a baseline JSON file', 'baseline.json')
  .action((options) => {
    const resultsDir = getRootPath('results');
    const comparisonPath = path.join(resultsDir, 'comparison.json');

    if (!fs.existsSync(comparisonPath)) {
      console.error(`Comparison metrics file not found. Please run 'pnpm orch run-all --golden' first.`);
      process.exit(1);
    }

    const metricsList: MetricsResult[] = JSON.parse(fs.readFileSync(comparisonPath, 'utf-8'));

    console.log('\n========================================================================================');
    console.log('                 📊 MULTI-AGENT ORCHESTRATION BENCHMARK EVALUATION RESULTS              ');
    console.log('========================================================================================');
    console.table(metricsList);

    const baselinePath = path.resolve(resultsDir, options.compare);
    if (fs.existsSync(baselinePath)) {
      console.log(`\n🔍 Baseline Comparison (${options.compare}):`);
      const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
      console.log(baselineData);
    }

    let mdContent = `# Results: Multi-Agent Orchestration Evaluation\n\n`;
    mdContent += `## Executive Summary\nEvaluation of 3-agent orchestration dynamics across 15 benchmark golden tasks targeting the Task 3 repository codebase.\n\n`;
    mdContent += `## Comparative Metrics Table\n\n`;
    mdContent += `| Metric | Single-Agent (A) | Critic No Cap (B) | Critic 3-Cap (C) | Critic Isolated (D) |\n`;
    mdContent += `|--------|------------------|-------------------|------------------|---------------------|\n`;

    const getVal = (idx: number, key: keyof MetricsResult) => (metricsList[idx] ? metricsList[idx][key] : 'N/A');

    mdContent += `| Task Success Rate | ${getVal(0, 'taskSuccessRate')} | ${getVal(1, 'taskSuccessRate')} | ${getVal(2, 'taskSuccessRate')} | ${getVal(3, 'taskSuccessRate')} |\n`;
    mdContent += `| Critic Catch Rate | N/A | ${getVal(1, 'criticCatchRate')} | ${getVal(2, 'criticCatchRate')} | ${getVal(3, 'criticCatchRate')} |\n`;
    mdContent += `| Rubber-Stamp Rate | N/A | ${getVal(1, 'rubberStampRate')} | ${getVal(2, 'rubberStampRate')} | ${getVal(3, 'rubberStampRate')} |\n`;
    mdContent += `| Mean Revision Rounds | ${getVal(0, 'meanRevisionRounds')} | ${getVal(1, 'meanRevisionRounds')} | ${getVal(2, 'meanRevisionRounds')} | ${getVal(3, 'meanRevisionRounds')} |\n`;
    mdContent += `| Redundant Round-Trip Ratio | N/A | ${getVal(1, 'redundantRoundTripRatio')} | ${getVal(2, 'redundantRoundTripRatio')} | ${getVal(3, 'redundantRoundTripRatio')} |\n`;
    mdContent += `| Tokens / Task | ${getVal(0, 'totalTokensPerTask')} | ${getVal(1, 'totalTokensPerTask')} | ${getVal(2, 'totalTokensPerTask')} | ${getVal(3, 'totalTokensPerTask')} |\n`;
    mdContent += `| Wall-Clock / Task (ms) | ${getVal(0, 'wallClockPerTaskMs')} | ${getVal(1, 'wallClockPerTaskMs')} | ${getVal(2, 'wallClockPerTaskMs')} | ${getVal(3, 'wallClockPerTaskMs')} |\n`;

    const resultsMdPath = getRootPath('docs/RESULTS.md');
    fs.writeFileSync(resultsMdPath, mdContent);
    console.log(`\n✨ Generated ${resultsMdPath}\n`);
  });

program.parse(process.argv);
