import { expandJobsWithBatchSplit } from './batchSplit.js';
import {
  MIN_MS,
  advanceWorkTime,
  isDifferentWorkDay,
  snapToWorkTime,
  toTimestampMs,
  workMinutesBetween,
} from './calendar.js';
import { DEFAULT_SETUP_RULES, setupTime } from './setup.js';

const RULES = new Set(['FIFO', 'EDD', 'SPT', 'ATCS']);

/**
 * Resolve processing time (minutes) of a job on a specific machine.
 */
export function getProcessingTimeMin(job, machine) {
  return job.processingTimeByMachine?.[machine.id] ?? job.processingTimeMin;
}

/**
 * Determine whether a machine can process the given job.
 */
export function isMachineEligible(job, machine) {
  if (Array.isArray(job.eligibleMachineIds) && job.eligibleMachineIds.length > 0) {
    return job.eligibleMachineIds.includes(machine.id);
  }
  if (job.machineType) {
    return machine.type === job.machineType;
  }
  return true;
}

function computeAverageProcessingMin(jobs, machines) {
  if (jobs.length === 0) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (const job of jobs) {
    const eligible = machines.filter((m) => isMachineEligible(job, m));
    if (eligible.length > 0) {
      const avgForJob =
        eligible.reduce((acc, m) => acc + getProcessingTimeMin(job, m), 0) / eligible.length;
      sum += avgForJob;
      count += 1;
    } else {
      sum += job.processingTimeMin ?? 0;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function computeAverageSetupMin(jobs, machines, rules) {
  if (jobs.length < 2 || machines.length === 0) {
    return 0;
  }
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < jobs.length; i += 1) {
    for (let j = 0; j < jobs.length; j += 1) {
      if (i === j) {
        continue;
      }
      const sharedMachine = machines.find(
        (m) => isMachineEligible(jobs[i], m) && isMachineEligible(jobs[j], m)
      );
      if (sharedMachine) {
        sum += setupTime(jobs[i], jobs[j], sharedMachine, rules, { isNewShift: false });
        pairs += 1;
      }
    }
  }
  return pairs > 0 ? sum / pairs : 0;
}

/**
 * Lee & Pinedo Apparent Tardiness Cost with Setups (ATCS) priority index (CLAUDE.md §7.3).
 */
export function computeAtcsIndex({
  job,
  machine,
  currentMs,
  pBar,
  sBar,
  setupMin,
  k1 = 2,
  k2 = 0.5,
}) {
  const p = getProcessingTimeMin(job, machine);
  const w = job.priority ?? 1;
  const dueMs = toTimestampMs(job.deadline);
  const timeToDueMin = workMinutesBetween(currentMs, dueMs, machine.calendar);
  const slackMin = Math.max(timeToDueMin - p, 0);

  const urgencyTerm = pBar > 0 ? Math.exp(-slackMin / (k1 * pBar)) : 1;
  // Guard sBar === 0 (e.g., identical setups across all jobs) to prevent division by zero.
  const setupTerm = sBar > 0 ? Math.exp(-setupMin / (k2 * sBar)) : 1;

  return (w / Math.max(p, 1e-6)) * urgencyTerm * setupTerm;
}

function findPrevJobInterval(candidateStartMs, occupiedIntervals) {
  let prev = null;
  let hadMaintenanceAfterPrev = false;
  for (const occ of occupiedIntervals) {
    if (occ.blockEndMs <= candidateStartMs) {
      if (occ.isMaintenance) {
        hadMaintenanceAfterPrev = true;
      } else {
        prev = occ;
        hadMaintenanceAfterPrev = false;
      }
    } else {
      break;
    }
  }
  return { prevOcc: prev, hadMaintenanceAfterPrev };
}

/**
 * Place a job's setup + processing window on a machine without overlapping occupied (locked or maintenance) intervals.
 */
export function findNextFreeSlot({ earliestMs, job, machine, rules, occupiedIntervals }) {
  const p = getProcessingTimeMin(job, machine);
  let candidateStartMs = snapToWorkTime(earliestMs, machine.calendar);

  // Occupied intervals are kept sorted chronologically by blockStartMs.
  for (let iter = 0; iter < 10000; iter += 1) {
    const { prevOcc, hadMaintenanceAfterPrev } = findPrevJobInterval(
      candidateStartMs,
      occupiedIntervals
    );
    const effectivePrev = prevOcc ? prevOcc.jobSnapshot : null;
    const isNewShift =
      prevOcc != null &&
      (hadMaintenanceAfterPrev ||
        (machine.calendar != null && isDifferentWorkDay(prevOcc.endMs, candidateStartMs)));

    const setupMin = setupTime(effectivePrev, job, machine, rules, { isNewShift });
    const setupStartMs = candidateStartMs;
    const setupEndMs =
      setupMin > 0 ? advanceWorkTime(setupStartMs, setupMin, machine.calendar) : setupStartMs;
    const startMs = setupEndMs;
    const endMs = p > 0 ? advanceWorkTime(startMs, p, machine.calendar) : startMs;

    const conflict = occupiedIntervals.find(
      (occ) => setupStartMs < occ.blockEndMs && endMs > occ.blockStartMs
    );

    if (!conflict) {
      return { setupStartMs, setupEndMs, startMs, endMs, setupMin, processingMin: p };
    }

    // Jump past the conflicting locked/maintenance interval and recompute setup relative to it.
    const jumpedMs = snapToWorkTime(conflict.blockEndMs, machine.calendar);
    candidateStartMs = jumpedMs > candidateStartMs ? jumpedMs : candidateStartMs + MIN_MS;
  }

  throw new Error(`Could not place job ${job.id} around occupied intervals on machine ${machine.id}`);
}

function buildEntryRecord({ job, machine, slot, locked }) {
  const dueMs = toTimestampMs(job.deadline);
  const latenessMin = Math.round((slot.endMs - dueMs) / MIN_MS);
  const tardinessMin = Math.max(0, latenessMin);

  return {
    jobId: job.id,
    parentJobId: job.parentJobId ?? job.id,
    batchIndex: job.batchIndex ?? 1,
    batchQty: job.batchQty ?? null,
    orderId: job.orderId ?? null,
    machineId: machine.id,
    machineType: machine.type,
    material: job.material ?? null,
    setupStart: new Date(slot.setupStartMs).toISOString(),
    setupEnd: new Date(slot.setupEndMs).toISOString(),
    start: new Date(slot.startMs).toISOString(),
    end: new Date(slot.endMs).toISOString(),
    setupMin: slot.setupMin,
    processingMin: slot.processingMin,
    deadline: new Date(dueMs).toISOString(),
    latenessMin,
    tardinessMin,
    isLate: tardinessMin > 0,
    locked,
  };
}

function insertOccupiedSorted(intervals, interval) {
  intervals.push(interval);
  intervals.sort((a, b) => a.blockStartMs - b.blockStartMs);
}

/**
 * Compute slot on an unlocked machine directly at its chronological tail in O(1).
 */
function buildTailSlot({ earliestMs, prevOcc, job, machine, rules }) {
  const p = getProcessingTimeMin(job, machine);
  const setupStartMs = snapToWorkTime(prevOcc ? prevOcc.endMs : earliestMs, machine.calendar);
  const isNewShift =
    prevOcc != null &&
    machine.calendar != null &&
    isDifferentWorkDay(prevOcc.endMs, setupStartMs);

  const setupMin = setupTime(prevOcc ? prevOcc.jobSnapshot : null, job, machine, rules, {
    isNewShift,
  });
  const setupEndMs =
    setupMin > 0 ? advanceWorkTime(setupStartMs, setupMin, machine.calendar) : setupStartMs;
  const startMs = setupEndMs;
  const endMs = p > 0 ? advanceWorkTime(startMs, p, machine.calendar) : startMs;

  return { setupStartMs, setupEndMs, startMs, endMs, setupMin, processingMin: p };
}

function pickCandidateForMachine({
  machine,
  candidates,
  occupied,
  hasLocked,
  startTimeMs,
  rules,
  params,
}) {
  let best = null;
  const tailOcc = !hasLocked && occupied.length > 0 ? occupied[occupied.length - 1] : null;

  for (const job of candidates) {
    const slot = hasLocked
      ? findNextFreeSlot({
          earliestMs: startTimeMs,
          job,
          machine,
          rules,
          occupiedIntervals: occupied,
        })
      : buildTailSlot({
          earliestMs: startTimeMs,
          prevOcc: tailOcc,
          job,
          machine,
          rules,
        });

    const atcsScore =
      params.rule === 'ATCS'
        ? computeAtcsIndex({
            job,
            machine,
            currentMs: slot.setupStartMs,
            pBar: params.pBar,
            sBar: params.sBar,
            setupMin: slot.setupMin,
            k1: params.k1,
            k2: params.k2,
          })
        : 0;

    if (!best || isBetterCandidate({ job, slot, atcsScore }, best, params.rule)) {
      best = { job, slot, atcsScore };
    }
  }

  return best;
}

function isBetterCandidate(next, best, rule) {
  if (rule === 'FIFO') {
    return next.job._index < best.job._index;
  }
  if (rule === 'EDD') {
    if (next.job._dueMs !== best.job._dueMs) {
      return next.job._dueMs < best.job._dueMs;
    }
    return next.job._index < best.job._index;
  }
  if (rule === 'SPT') {
    if (next.slot.processingMin !== best.slot.processingMin) {
      return next.slot.processingMin < best.slot.processingMin;
    }
    if (next.job._dueMs !== best.job._dueMs) {
      return next.job._dueMs < best.job._dueMs;
    }
    return next.job._index < best.job._index;
  }
  // ATCS: higher index wins; break ties deterministically by earliest deadline then queue order.
  if (Math.abs(next.atcsScore - best.atcsScore) > 1e-12) {
    return next.atcsScore > best.atcsScore;
  }
  if (next.job._dueMs !== best.job._dueMs) {
    return next.job._dueMs < best.job._dueMs;
  }
  return next.job._index < best.job._index;
}

function computeScheduleMetrics({ entries, unscheduled, machines, startTimeMs }) {
  const totalJobs = entries.length + unscheduled.length;
  const lateCount = entries.filter((e) => e.isLate).length;
  const totalTardinessMin = entries.reduce((sum, e) => sum + e.tardinessMin, 0);
  const maxTardinessMin = entries.reduce((max, e) => Math.max(max, e.tardinessMin), 0);
  const totalSetupMin = entries.reduce((sum, e) => sum + e.setupMin, 0);
  const totalProcessingMin = entries.reduce((sum, e) => sum + e.processingMin, 0);

  let maxEndMs = startTimeMs;
  for (const e of entries) {
    maxEndMs = Math.max(maxEndMs, toTimestampMs(e.end));
  }
  const makespanMin = entries.length > 0 ? Math.max(0, Math.round((maxEndMs - startTimeMs) / MIN_MS)) : 0;

  const utilizationByMachine = {};
  for (const machine of machines) {
    const machineEntries = entries.filter((e) => e.machineId === machine.id);
    if (machineEntries.length === 0) {
      utilizationByMachine[machine.id] = 0;
      continue;
    }
    const busyProcMin = machineEntries.reduce((sum, e) => sum + e.processingMin, 0);
    const horizonWorkMin = Math.max(
      workMinutesBetween(startTimeMs, maxEndMs, machine.calendar),
      busyProcMin
    );
    utilizationByMachine[machine.id] =
      horizonWorkMin > 0 ? Number((busyProcMin / horizonWorkMin).toFixed(4)) : 0;
  }

  const utilValues = Object.values(utilizationByMachine);
  const avgUtilization =
    utilValues.length > 0
      ? Number((utilValues.reduce((sum, u) => sum + u, 0) / utilValues.length).toFixed(4))
      : 0;

  return {
    totalJobs,
    scheduledJobs: entries.length,
    unscheduledJobs: unscheduled.length,
    lateCount,
    totalTardinessMin,
    maxTardinessMin,
    totalSetupMin,
    totalProcessingMin,
    makespanMin,
    utilizationByMachine,
    avgUtilization,
  };
}

/**
 * Schedule workshop jobs across machines using list scheduling (FIFO, EDD, SPT, or ATCS).
 * Does not mutate any caller-supplied arrays or objects.
 */
export function schedule(jobs = [], machines = [], rules = DEFAULT_SETUP_RULES, options = {}) {
  const rule = options.rule ?? 'ATCS';
  if (!RULES.has(rule)) {
    throw new Error(`Unsupported scheduling rule: ${rule}`);
  }

  const k1 = options.k1 ?? 2;
  const k2 = options.k2 ?? 0.5;
  const enableBatchSplit = Boolean(options.enableBatchSplit);
  const minSplitQty = options.minSplitQty ?? 4;
  const minBatchQty = options.minBatchQty ?? 2;
  const startTimeMs = toTimestampMs(options.startTime ?? Date.now());

  const machineList = machines.map((m) => ({ ...m }));
  const occupiedByMachine = new Map(machineList.map((m) => [m.id, []]));
  const hasLockedByMachine = new Set();

  // Pre-occupy scheduled maintenance windows so neither setup nor processing crosses them.
  for (const machine of machineList) {
    const occupied = occupiedByMachine.get(machine.id);
    for (const win of machine.maintenanceWindows ?? []) {
      const wStartMs = toTimestampMs(win.start);
      const wEndMs = toTimestampMs(win.end);
      if (wEndMs > wStartMs) {
        hasLockedByMachine.add(machine.id);
        insertOccupiedSorted(occupied, {
          blockStartMs: wStartMs,
          blockEndMs: wEndMs,
          endMs: wEndMs,
          isMaintenance: true,
          jobSnapshot: null,
        });
      }
    }
  }

  const normalizedJobs = jobs.map((job, index) => ({
    ...job,
    _index: index,
    _dueMs: toTimestampMs(job.deadline),
  }));

  const lockedByJobId = new Map();
  for (const lock of options.locked ?? []) {
    lockedByJobId.set(lock.jobId, lock);
  }

  const entries = [];
  const remaining = [];

  for (const job of normalizedJobs) {
    const lockInfo =
      lockedByJobId.get(job.id) ?? (job.locked ? { jobId: job.id, ...job } : null);

    if (lockInfo && occupiedByMachine.has(lockInfo.machineId)) {
      const machine = machineList.find((m) => m.id === lockInfo.machineId);
      const startMs = toTimestampMs(lockInfo.start);
      const endMs = toTimestampMs(lockInfo.end);
      const setupStartMs = toTimestampMs(lockInfo.setupStart ?? lockInfo.start);
      const setupEndMs = toTimestampMs(lockInfo.setupEnd ?? lockInfo.start);
      const setupMin =
        lockInfo.setupMin ?? Math.max(0, Math.round((setupEndMs - setupStartMs) / MIN_MS));
      const processingMin =
        lockInfo.processingMin ?? Math.max(0, Math.round((endMs - startMs) / MIN_MS));

      const slot = { setupStartMs, setupEndMs, startMs, endMs, setupMin, processingMin };
      entries.push(buildEntryRecord({ job, machine, slot, locked: true }));
      hasLockedByMachine.add(machine.id);
      insertOccupiedSorted(occupiedByMachine.get(machine.id), {
        blockStartMs: setupStartMs,
        blockEndMs: endMs,
        endMs,
        isMaintenance: false,
        jobSnapshot: job,
      });
    } else {
      remaining.push(job);
    }
  }

  const schedulableJobs = enableBatchSplit
    ? expandJobsWithBatchSplit(remaining, machineList, { minSplitQty, minBatchQty })
    : remaining;

  const unscheduled = [];
  const pBar = computeAverageProcessingMin(schedulableJobs, machineList);
  const sBar = computeAverageSetupMin(schedulableJobs, machineList, rules);

  // Filter out jobs that have no eligible machine up front.
  let activeQueue = [];
  for (const job of schedulableJobs) {
    if (machineList.some((m) => isMachineEligible(job, m))) {
      activeQueue.push(job);
    } else {
      unscheduled.push({
        jobId: job.id,
        orderId: job.orderId ?? null,
        reason: 'NO_ELIGIBLE_MACHINE',
      });
    }
  }

  while (activeQueue.length > 0) {
    // Select the eligible machine whose earliest candidate start is minimal (classic list scheduling).
    let chosenMachine = null;
    let chosenEarliestStart = Infinity;
    let chosenCandidates = [];

    for (const machine of machineList) {
      const candidates = activeQueue.filter((j) => isMachineEligible(j, machine));
      if (candidates.length === 0) {
        continue;
      }
      const occupied = occupiedByMachine.get(machine.id);
      const machineHasLocked = hasLockedByMachine.has(machine.id);
      let machineMinStart = Infinity;

      if (!machineHasLocked) {
        // Unlocked machine: all candidates share the same O(1) chronological tail availability.
        const prevEnd = occupied.length > 0 ? occupied[occupied.length - 1].endMs : startTimeMs;
        machineMinStart = snapToWorkTime(prevEnd, machine.calendar);
      } else {
        for (const job of candidates) {
          const slot = findNextFreeSlot({
            earliestMs: startTimeMs,
            job,
            machine,
            rules,
            occupiedIntervals: occupied,
          });
          if (slot.setupStartMs < machineMinStart) {
            machineMinStart = slot.setupStartMs;
          }
        }
      }

      if (machineMinStart < chosenEarliestStart) {
        chosenEarliestStart = machineMinStart;
        chosenMachine = machine;
        chosenCandidates = candidates;
      }
    }

    if (!chosenMachine) {
      break;
    }

    const occupied = occupiedByMachine.get(chosenMachine.id);
    const chosenHasLocked = hasLockedByMachine.has(chosenMachine.id);
    const chosen = pickCandidateForMachine({
      machine: chosenMachine,
      candidates: chosenCandidates,
      occupied,
      hasLocked: chosenHasLocked,
      startTimeMs,
      rules,
      params: { rule, pBar, sBar, k1, k2 },
    });

    entries.push(buildEntryRecord({ job: chosen.job, machine: chosenMachine, slot: chosen.slot, locked: false }));
    const newInterval = {
      blockStartMs: chosen.slot.setupStartMs,
      blockEndMs: chosen.slot.endMs,
      endMs: chosen.slot.endMs,
      isMaintenance: false,
      jobSnapshot: chosen.job,
    };
    if (chosenHasLocked) {
      insertOccupiedSorted(occupied, newInterval);
    } else {
      occupied.push(newInterval);
    }

    activeQueue = activeQueue.filter((j) => j.id !== chosen.job.id);
  }

  entries.sort((a, b) => Date.parse(a.setupStart) - Date.parse(b.setupStart));

  const metrics = computeScheduleMetrics({
    entries,
    unscheduled,
    machines: machineList,
    startTimeMs,
  });

  return {
    rule,
    startTime: new Date(startTimeMs).toISOString(),
    entries,
    unscheduled,
    metrics,
  };
}

/**
 * Evaluate FIFO, EDD, SPT, and ATCS on the identical input data for strategy comparison.
 */
export function compareStrategies(jobs, machines, rules = DEFAULT_SETUP_RULES, options = {}) {
  const names = ['FIFO', 'EDD', 'SPT', 'ATCS'];
  const strategies = {};
  const schedules = {};

  for (const name of names) {
    const res = schedule(jobs, machines, rules, { ...options, rule: name });
    schedules[name] = res;
    strategies[name] = res.metrics;
  }

  const bestByTardiness = [...names].sort((a, b) => {
    if (strategies[a].totalTardinessMin !== strategies[b].totalTardinessMin) {
      return strategies[a].totalTardinessMin - strategies[b].totalTardinessMin;
    }
    if (strategies[a].lateCount !== strategies[b].lateCount) {
      return strategies[a].lateCount - strategies[b].lateCount;
    }
    return strategies[a].totalSetupMin - strategies[b].totalSetupMin;
  })[0];

  const bestBySetup = [...names].sort(
    (a, b) => strategies[a].totalSetupMin - strategies[b].totalSetupMin
  )[0];

  return { strategies, schedules, bestByTardiness, bestBySetup };
}
