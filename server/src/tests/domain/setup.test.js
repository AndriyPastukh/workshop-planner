import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETUP_RULES,
  lookupMaterialChangeMinutes,
  setupTime,
  setupTimeBreakdown,
} from '../../domain/setup.js';

const FDM_RULES = {
  baseMinutes: { fdm_3d: 10 },
  warmupMinutes: { fdm_3d: 15 },
  colorChangeMinutes: { fdm_3d: 8 },
  toolChangeMinutes: { fdm_3d: 20 },
  defaultMaterialChangeMinutes: { fdm_3d: 18 },
  materialMatrix: {
    fdm_3d: {
      PLA: { PETG: 15, ABS: 60 },
      PETG: { PLA: 20, ABS: 30 },
    },
  },
};

describe('setup domain', () => {
  it('calculates Example 2 reference cases for fdm_3d machine', () => {
    const machine = { id: 'm1', type: 'fdm_3d' };
    const jobPlaBlack04 = { material: 'PLA', color: 'black', tool: '0.4mm' };
    const jobPetgWhite06 = { material: 'PETG', color: 'white', tool: '0.6mm' };
    const jobPlaWhite06 = { material: 'PLA', color: 'white', tool: '0.6mm' };

    // 1. First job of shift (prev = null): base (10) + warmup (15) = 25
    expect(setupTimeBreakdown(null, jobPlaBlack04, machine, FDM_RULES)).toEqual({
      total: 25,
      base: 10,
      materialChange: 0,
      colorChange: 0,
      toolChange: 0,
      warmup: 15,
    });

    // 2. Identical material, color, and tool: base only (10)
    expect(setupTime(jobPlaBlack04, { ...jobPlaBlack04 }, machine, FDM_RULES)).toBe(10);

    // 3. PLA/black/0.4mm -> PETG/white/0.6mm: 10 + 15 + 8 + 20 = 53
    expect(setupTimeBreakdown(jobPlaBlack04, jobPetgWhite06, machine, FDM_RULES)).toEqual({
      total: 53,
      base: 10,
      materialChange: 15,
      colorChange: 8,
      toolChange: 20,
      warmup: 0,
    });

    // 4. Asymmetric PETG/white/0.6mm -> PLA/white/0.6mm: 10 + 20 = 30
    expect(setupTime(jobPetgWhite06, jobPlaWhite06, machine, FDM_RULES)).toBe(30);
  });

  it('supports DB-style array setup_rules alongside nested map format', () => {
    const machine = { id: 'm2', type: 'laser' };
    const arrayRules = {
      baseMinutes: { laser: 5 },
      warmupMinutes: { laser: 5 },
      colorChangeMinutes: { laser: 0 },
      toolChangeMinutes: { laser: 10 },
      defaultMaterialChangeMinutes: { laser: 7 },
      materialMatrix: [
        { machineType: 'laser', fromMaterial: 'plywood', toMaterial: 'acrylic', minutes: 12 },
        { machineType: 'laser', fromMaterial: 'acrylic', toMaterial: 'plywood', minutes: 14 },
      ],
    };

    expect(lookupMaterialChangeMinutes('laser', 'plywood', 'acrylic', arrayRules)).toBe(12);
    expect(lookupMaterialChangeMinutes('laser', 'acrylic', 'plywood', arrayRules)).toBe(14);
    expect(lookupMaterialChangeMinutes('laser', 'plywood', 'plywood', arrayRules)).toBe(0);
    // Unlisted pair falls back to defaultMaterialChangeMinutes for that machine type
    expect(lookupMaterialChangeMinutes('laser', 'plywood', 'mdf', arrayRules)).toBe(7);

    expect(
      setupTime(
        { material: 'plywood', tool: '2in' },
        { material: 'acrylic', tool: '1.5in' },
        machine,
        arrayRules
      )
    ).toBe(5 + 12 + 10);
  });

  it('adds warmup when options.isNewShift is true even if prev job exists', () => {
    const machine = { id: 'm1', type: 'fdm_3d' };
    const prev = { material: 'PLA', color: 'black', tool: '0.4mm' };
    const next = { material: 'PLA', color: 'white', tool: '0.4mm' };

    expect(setupTimeBreakdown(prev, next, machine, FDM_RULES, { isNewShift: true })).toEqual({
      total: 33, // 10 base + 8 color + 15 warmup
      base: 10,
      materialChange: 0,
      colorChange: 8,
      toolChange: 0,
      warmup: 15,
    });
  });

  it('falls back gracefully when machine type or rule entries are missing', () => {
    const unknownMachine = { id: 'm9', type: 'custom_cnc' };
    expect(setupTime(null, { material: 'oak' }, unknownMachine, FDM_RULES)).toBe(0);
    expect(
      setupTime({ material: 'oak' }, { material: 'pine' }, unknownMachine, FDM_RULES)
    ).toBe(0);
    expect(setupTime(null, { material: 'PLA' }, { type: 'fdm_3d' }, DEFAULT_SETUP_RULES)).toBe(25);

    // Numeric scalar rule groups and direct array matrix input
    const scalarRules = {
      baseMinutes: 5,
      warmupMinutes: 10,
      colorChangeMinutes: 3,
      toolChangeMinutes: 4,
      materialMatrix: [{ fromMaterial: 'PLA', toMaterial: 'ABS', minutes: 12 }],
    };
    expect(
      setupTime(
        { material: 'PLA', color: 'a', tool: 'x' },
        { material: 'ABS', color: 'b', tool: 'y' },
        { type: 'fdm_3d' },
        scalarRules
      )
    ).toBe(5 + 12 + 3 + 4);
    expect(lookupMaterialChangeMinutes('fdm_3d', 'PLA', 'ABS', scalarRules.materialMatrix)).toBe(
      12
    );
  });
});
