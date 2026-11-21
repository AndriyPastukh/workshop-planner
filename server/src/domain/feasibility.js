import { MIN_MS, toTimestampMs } from './calendar.js';
import { roundMoney } from './pricing.js';
import { isMachineEligible, schedule } from './scheduler.js';
import { DEFAULT_SETUP_RULES } from './setup.js';

function summarizeImpact(baselineEntries, simulatedEntries, newJobIds) {
  const baselineByJobId = new Map(baselineEntries.map((e) => [e.jobId, e]));
  const shiftedOrders = [];
  const newlyDelayedOrders = [];

  for (const simEntry of simulatedEntries) {
    if (newJobIds.has(simEntry.jobId)) {
      continue;
    }
    const baseEntry = baselineByJobId.get(simEntry.jobId);
    if (!baseEntry) {
      continue;
    }

    const oldEndMs = toTimestampMs(baseEntry.end);
    const newEndMs = toTimestampMs(simEntry.end);
    if (newEndMs > oldEndMs) {
      shiftedOrders.push({
        orderId: simEntry.orderId,
        jobId: simEntry.jobId,
        oldEnd: baseEntry.end,
        newEnd: simEntry.end,
        shiftMin: Math.round((newEndMs - oldEndMs) / MIN_MS),
      });
    }

    if (simEntry.tardinessMin > baseEntry.tardinessMin) {
      newlyDelayedOrders.push({
        orderId: simEntry.orderId,
        jobId: simEntry.jobId,
        oldTardinessMin: baseEntry.tardinessMin,
        newTardinessMin: simEntry.tardinessMin,
        dueDate: simEntry.deadline,
      });
    }
  }

  return { shiftedOrders, newlyDelayedOrders };
}

function getNewOrderFinishIso(entries, newJobIds) {
  let maxFinishMs = -Infinity;
  for (const entry of entries) {
    if (newJobIds.has(entry.jobId)) {
      maxFinishMs = Math.max(maxFinishMs, toTimestampMs(entry.end));
    }
  }
  return Number.isFinite(maxFinishMs) ? new Date(maxFinishMs).toISOString() : null;
}

/**
 * Simulate inserting a hypothetical new order into the current schedule without mutating DB state.
 * Evaluates standard priority and rush priority to recommend acceptance, rush surcharge, or a later deadline.
 */
export function checkFeasibility(
  currentJobs = [],
  newOrder,
  machines = [],
  rules = DEFAULT_SETUP_RULES,
  options = {}
) {
  const orderId = newOrder?.id ?? 'NEW_ORDER';
  const basePriority = newOrder?.priority ?? 1;
  const items = newOrder?.items ?? [];

  const buildOrderJobs = (priorityOverride) =>
    items.map((item, idx) => ({
      ...item,
      id: item.id ?? `${orderId}-item-${idx + 1}`,
      orderId,
      deadline: item.deadline ?? newOrder.deadline,
      priority: priorityOverride ?? item.priority ?? basePriority,
    }));

  const normalJobs = buildOrderJobs();
  const hasAllEligibleMachines =
    normalJobs.length > 0 &&
    normalJobs.every((job) => machines.some((machine) => isMachineEligible(job, machine)));

  if (!hasAllEligibleMachines) {
    return {
      feasible: false,
      recommendation: 'INFEASIBLE',
      meetsDeadline: false,
      meetsDeadlineWithRush: false,
      earliestFinish: null,
      rushEarliestFinish: null,
      tardinessMin: null,
      suggestedDeadline: null,
      recommendedRushSurcharge: null,
      shiftedOrders: [],
      newlyDelayedOrders: [],
      metrics: null,
    };
  }

  const scheduleOpts = {
    rule: options.rule ?? 'ATCS',
    k1: options.k1 ?? 2,
    k2: options.k2 ?? 0.5,
    startTime: options.startTime ?? Date.now(),
    locked: options.locked ?? [],
  };

  const baseline = options.baselineSchedule ?? schedule(currentJobs, machines, rules, scheduleOpts);
  const simNormal = schedule([...currentJobs, ...normalJobs], machines, rules, scheduleOpts);

  const newJobIds = new Set(normalJobs.map((j) => j.id));
  if (simNormal.unscheduled.some((u) => newJobIds.has(u.jobId))) {
    return {
      feasible: false,
      recommendation: 'INFEASIBLE',
      meetsDeadline: false,
      meetsDeadlineWithRush: false,
      earliestFinish: null,
      rushEarliestFinish: null,
      tardinessMin: null,
      suggestedDeadline: null,
      recommendedRushSurcharge: null,
      shiftedOrders: [],
      newlyDelayedOrders: [],
      metrics: null,
    };
  }

  const dueMs = toTimestampMs(newOrder.deadline);
  const earliestFinish = getNewOrderFinishIso(simNormal.entries, newJobIds);
  const tardinessMin = Math.max(0, Math.round((toTimestampMs(earliestFinish) - dueMs) / MIN_MS));
  const meetsDeadline = tardinessMin === 0;
  const normalImpact = summarizeImpact(baseline.entries, simNormal.entries, newJobIds);

  if (meetsDeadline && normalImpact.newlyDelayedOrders.length === 0) {
    return {
      feasible: true,
      recommendation: 'ACCEPT_STANDARD',
      meetsDeadline: true,
      meetsDeadlineWithRush: true,
      earliestFinish,
      rushEarliestFinish: earliestFinish,
      tardinessMin: 0,
      suggestedDeadline: earliestFinish,
      recommendedRushSurcharge: 0,
      shiftedOrders: normalImpact.shiftedOrders,
      newlyDelayedOrders: [],
      metrics: simNormal.metrics,
    };
  }

  // Test a rush priority above existing normal priorities to see if expediting rescues the deadline.
  const maxExistingPriority = currentJobs.reduce((max, j) => Math.max(max, j.priority ?? 1), 1);
  const rushPriority = Math.max(maxExistingPriority + 2, basePriority * 2, 5);
  const rushJobs = buildOrderJobs(rushPriority);
  const simRush = schedule([...currentJobs, ...rushJobs], machines, rules, scheduleOpts);

  const rushEarliestFinish = getNewOrderFinishIso(simRush.entries, newJobIds);
  const rushTardinessMin = Math.max(
    0,
    Math.round((toTimestampMs(rushEarliestFinish) - dueMs) / MIN_MS)
  );
  const meetsDeadlineWithRush = rushTardinessMin === 0;
  const rushImpact = summarizeImpact(baseline.entries, simRush.entries, newJobIds);

  if (meetsDeadlineWithRush) {
    const baseRushSurcharge = options.baseRushSurcharge ?? 0.25;
    const affectedOrderCount = new Set(rushImpact.newlyDelayedOrders.map((d) => d.orderId)).size;
    const recommendedRushSurcharge = roundMoney(
      Math.min(0.5, baseRushSurcharge + 0.05 * affectedOrderCount)
    );

    return {
      feasible: true,
      recommendation: 'ACCEPT_WITH_RUSH',
      meetsDeadline,
      meetsDeadlineWithRush: true,
      earliestFinish,
      rushEarliestFinish,
      tardinessMin,
      suggestedDeadline: rushEarliestFinish,
      recommendedRushSurcharge,
      shiftedOrders: rushImpact.shiftedOrders,
      newlyDelayedOrders: rushImpact.newlyDelayedOrders,
      metrics: simRush.metrics,
    };
  }

  const bestPossibleFinish =
    toTimestampMs(rushEarliestFinish) < toTimestampMs(earliestFinish)
      ? rushEarliestFinish
      : earliestFinish;

  return {
    feasible: true,
    recommendation: 'NEGOTIATE_DEADLINE',
    meetsDeadline: false,
    meetsDeadlineWithRush: false,
    earliestFinish,
    rushEarliestFinish,
    tardinessMin,
    suggestedDeadline: bestPossibleFinish,
    recommendedRushSurcharge: null,
    shiftedOrders: normalImpact.shiftedOrders,
    newlyDelayedOrders: normalImpact.newlyDelayedOrders,
    metrics: simNormal.metrics,
  };
}
