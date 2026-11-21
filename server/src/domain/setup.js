export const DEFAULT_SETUP_RULES = {
  baseMinutes: {
    fdm_3d: 10,
    resin_3d: 12,
    laser: 5,
    cnc_wood: 15,
  },
  warmupMinutes: {
    fdm_3d: 15,
    resin_3d: 10,
    laser: 5,
    cnc_wood: 10,
  },
  colorChangeMinutes: {
    fdm_3d: 8,
    resin_3d: 10,
    laser: 0,
    cnc_wood: 5,
  },
  toolChangeMinutes: {
    fdm_3d: 20,
    resin_3d: 15,
    laser: 10,
    cnc_wood: 15,
  },
  defaultMaterialChangeMinutes: {
    fdm_3d: 15,
    resin_3d: 25,
    laser: 5,
    cnc_wood: 10,
  },
  materialMatrix: {
    fdm_3d: {
      PLA: { PETG: 15, ABS: 60 },
      PETG: { PLA: 20, ABS: 30 },
      ABS: { PLA: 60, PETG: 35 },
    },
    resin_3d: {
      RESIN_STD: { RESIN_TOUGH: 25 },
      RESIN_TOUGH: { RESIN_STD: 30 },
    },
    laser: {
      plywood_3mm: { acrylic_3mm: 8 },
      acrylic_3mm: { plywood_3mm: 10 },
    },
    cnc_wood: {
      pine: { oak: 12 },
      oak: { pine: 8 },
    },
  },
};

function readTypeRule(ruleGroup, machineType) {
  if (typeof ruleGroup === 'number') {
    return ruleGroup;
  }
  return ruleGroup?.[machineType] ?? 0;
}

/**
 * Look up asymmetric transition time (minutes) when switching from one material to another.
 * Supports both DB-style array rows and nested map structures.
 */
export function lookupMaterialChangeMinutes(
  machineType,
  fromMaterial,
  toMaterial,
  rules = DEFAULT_SETUP_RULES
) {
  if (!fromMaterial || !toMaterial || fromMaterial === toMaterial) {
    return 0;
  }

  const matrix = Array.isArray(rules) ? rules : rules?.materialMatrix;

  if (Array.isArray(matrix)) {
    const row = matrix.find(
      (entry) =>
        (!entry.machineType || entry.machineType === machineType) &&
        entry.fromMaterial === fromMaterial &&
        entry.toMaterial === toMaterial
    );
    if (row != null) {
      return row.minutes;
    }
  } else if (matrix?.[machineType]?.[fromMaterial]?.[toMaterial] != null) {
    return matrix[machineType][fromMaterial][toMaterial];
  }

  return readTypeRule(rules?.defaultMaterialChangeMinutes, machineType);
}

/**
 * Calculate sequence-dependent machine changeover breakdown (CLAUDE.md §7.2).
 */
export function setupTimeBreakdown(
  prev,
  next,
  machine,
  rules = DEFAULT_SETUP_RULES,
  options = {}
) {
  const machineType = machine?.type ?? next?.machineType ?? 'fdm_3d';
  const isFirst = prev == null;

  const base = readTypeRule(rules?.baseMinutes, machineType);
  const warmup = isFirst || options.isNewShift ? readTypeRule(rules?.warmupMinutes, machineType) : 0;

  let materialChange = 0;
  let colorChange = 0;
  let toolChange = 0;

  if (!isFirst) {
    materialChange = lookupMaterialChangeMinutes(machineType, prev.material, next?.material, rules);
    if (prev.color && next?.color && prev.color !== next.color) {
      colorChange = readTypeRule(rules?.colorChangeMinutes, machineType);
    }
    if (prev.tool && next?.tool && prev.tool !== next.tool) {
      toolChange = readTypeRule(rules?.toolChangeMinutes, machineType);
    }
  }

  const total = base + materialChange + colorChange + toolChange + warmup;
  return { total, base, materialChange, colorChange, toolChange, warmup };
}

/**
 * Return total sequence-dependent setup time in minutes.
 */
export function setupTime(prev, next, machine, rules = DEFAULT_SETUP_RULES, options = {}) {
  return setupTimeBreakdown(prev, next, machine, rules, options).total;
}
