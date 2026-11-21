function isEligibleForMachine(job, machine) {
  if (Array.isArray(job.eligibleMachineIds) && job.eligibleMachineIds.length > 0) {
    return job.eligibleMachineIds.includes(machine.id);
  }
  if (job.machineType) {
    return machine.type === job.machineType;
  }
  return true;
}

/**
 * Split a large multi-unit job into balanced sub-batches across compatible machines (CLAUDE.md §6.5).
 * Locked jobs, small quantities, or single-machine classes remain intact.
 */
export function splitJobIntoBatches(job, machines = [], options = {}) {
  const minSplitQty = options.minSplitQty ?? 4;
  const minBatchQty = options.minBatchQty ?? 2;

  if (!job || job.locked || !Number.isInteger(job.qty) || job.qty < minSplitQty) {
    return [job];
  }

  const eligible = machines.filter((m) => isEligibleForMachine(job, m));
  if (eligible.length < 2) {
    return [job];
  }

  const batchCount = Math.min(eligible.length, Math.floor(job.qty / minBatchQty));
  if (batchCount < 2) {
    return [job];
  }

  const baseQty = Math.floor(job.qty / batchCount);
  const remainder = job.qty % batchCount;
  const totalProcMin = job.processingTimeMin ?? 0;

  const batches = [];
  for (let i = 0; i < batchCount; i += 1) {
    const batchQty = baseQty + (i < remainder ? 1 : 0);
    const ratio = batchQty / job.qty;
    const scaledProcMin = Math.max(15, Math.round(totalProcMin * ratio));

    let scaledByMachine;
    if (job.processingTimeByMachine) {
      scaledByMachine = Object.fromEntries(
        Object.entries(job.processingTimeByMachine).map(([machineId, min]) => [
          machineId,
          Math.max(15, Math.round(min * ratio)),
        ])
      );
    }

    batches.push({
      ...job,
      id: `${job.id}::b${i + 1}`,
      parentJobId: job.id,
      batchIndex: i + 1,
      batchQty,
      batchCount,
      qty: batchQty,
      processingTimeMin: scaledProcMin,
      ...(scaledByMachine ? { processingTimeByMachine: scaledByMachine } : {}),
    });
  }

  return batches;
}

/**
 * Expand a job list by splitting eligible multi-unit items across parallel compatible machines.
 */
export function expandJobsWithBatchSplit(jobs = [], machines = [], options = {}) {
  const expanded = [];
  for (const job of jobs) {
    const parts = splitJobIntoBatches(job, machines, options);
    for (const part of parts) {
      expanded.push(part);
    }
  }
  return expanded;
}
