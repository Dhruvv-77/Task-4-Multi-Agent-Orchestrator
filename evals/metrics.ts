import { Trajectory } from '../packages/orchestrator/src/types/messages.js';

export interface MetricsResult {
  configName: string;
  taskSuccessRate: number;          // 0 - 1
  criticCatchRate: number;          // 0 - 1 (seeded flaws)
  rubberStampRate: number;          // 0 - 1
  meanRevisionRounds: number;       // Average turns
  redundantRoundTripRatio: number;  // 0 - 1
  totalTokensPerTask: number;       // Mean tokens
  wallClockPerTaskMs: number;       // Mean execution time ms
  sampleSize: number;
}

export function computeMetrics(configName: string, trajectories: Trajectory[]): MetricsResult {
  if (trajectories.length === 0) {
    return {
      configName,
      taskSuccessRate: 0,
      criticCatchRate: 0,
      rubberStampRate: 0,
      meanRevisionRounds: 0,
      redundantRoundTripRatio: 0,
      totalTokensPerTask: 0,
      wallClockPerTaskMs: 0,
      sampleSize: 0,
    };
  }

  // 1. Task Success Rate
  const successfulTasks = trajectories.filter(
    (t) => t.finalOutcome === 'approved' || t.finalOutcome === 'clarification-requested'
  ).length;
  const taskSuccessRate = successfulTasks / trajectories.length;

  // 2. Critic Catch Rate (Seeded Flaws)
  const seededTasks = trajectories.filter((t) => t.category === 'seeded-flaw');
  let caughtSeededFlaws = 0;
  for (const t of seededTasks) {
    if (t.reviews.length > 0) {
      const firstReview = t.reviews[0];
      const hasBlocker = firstReview.issues.some((i) => i.severity === 'blocker');
      if (firstReview.verdict === 'revise' || hasBlocker) {
        caughtSeededFlaws++;
      }
    }
  }
  const criticCatchRate = seededTasks.length > 0 ? caughtSeededFlaws / seededTasks.length : 0;

  // 3. Rubber Stamp Rate
  let rubberStamps = 0;
  let approvalCount = 0;
  for (const t of trajectories) {
    if (t.reviews.length > 0 && t.finalOutcome === 'approved') {
      approvalCount++;
      if (t.category === 'seeded-flaw' && t.reviews[0].verdict === 'approve') {
        rubberStamps++;
      }
    }
  }
  const rubberStampRate = approvalCount > 0 ? rubberStamps / approvalCount : 0;

  // 4. Mean Revision Rounds
  const totalRounds = trajectories.reduce((sum, t) => sum + Math.max(1, t.reviews.length), 0);
  const meanRevisionRounds = totalRounds / trajectories.length;

  // 5. Redundant Round-Trip Ratio
  let totalRevisions = 0;
  let redundantRevisions = 0;
  for (const t of trajectories) {
    if (t.reviews.length > 1) {
      totalRevisions += t.reviews.length - 1;
      for (let i = 1; i < t.reviews.length; i++) {
        const prevIssues = t.reviews[i - 1].issues.map((iss) => iss.note).join('|');
        const currIssues = t.reviews[i].issues.map((iss) => iss.note).join('|');
        if (prevIssues === currIssues && prevIssues.length > 0) {
          redundantRevisions++;
        }
      }
    }
  }
  const redundantRoundTripRatio = totalRevisions > 0 ? redundantRevisions / totalRevisions : 0;

  // 6. Tokens & Wall Clock Performance
  const sumTokens = trajectories.reduce((sum, t) => sum + t.totalTokens, 0);
  const sumWallClock = trajectories.reduce((sum, t) => sum + t.wallClockMs, 0);

  return {
    configName,
    taskSuccessRate: Number(taskSuccessRate.toFixed(3)),
    criticCatchRate: Number(criticCatchRate.toFixed(3)),
    rubberStampRate: Number(rubberStampRate.toFixed(3)),
    meanRevisionRounds: Number(meanRevisionRounds.toFixed(2)),
    redundantRoundTripRatio: Number(redundantRoundTripRatio.toFixed(3)),
    totalTokensPerTask: Math.round(sumTokens / trajectories.length),
    wallClockPerTaskMs: Math.round(sumWallClock / trajectories.length),
    sampleSize: trajectories.length,
  };
}
