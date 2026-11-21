import { prisma } from '../db.js';
import { DEFAULT_SETUP_RULES } from '../domain/index.js';
import { notFound } from '../lib/errors.js';
import { logAudit } from './auditService.js';

/**
 * Load global workshop settings singleton ('default').
 */
export async function getSettings() {
  const settings = await prisma.setting.findUnique({ where: { id: 'default' } });
  if (!settings) {
    throw notFound('Налаштування майстерні не ініціалізовано (виконайте db:seed)');
  }
  return settings;
}

/**
 * Update global workshop settings and record an audit entry.
 */
export async function updateSettings(patch, userId = null) {
  const existing = await getSettings();

  const updated = await prisma.setting.update({
    where: { id: existing.id },
    data: patch,
  });

  await logAudit({
    userId,
    action: 'SETTINGS_UPDATED',
    entity: 'setting',
    entityId: updated.id,
    payload: patch,
  });

  return updated;
}

/**
 * Assemble setup rules config object expected by domain/setup.js and domain/scheduler.js.
 */
export async function getSetupRulesConfig() {
  const [settings, setupRules] = await Promise.all([
    getSettings(),
    prisma.setupRule.findMany({
      orderBy: [{ machineType: 'asc' }, { fromMaterial: 'asc' }, { toMaterial: 'asc' }],
    }),
  ]);

  const defaults = settings.setupDefaults ?? {};
  return {
    baseMinutes: defaults.baseMinutes ?? DEFAULT_SETUP_RULES.baseMinutes,
    warmupMinutes: defaults.warmupMinutes ?? DEFAULT_SETUP_RULES.warmupMinutes,
    colorChangeMinutes: defaults.colorChangeMinutes ?? DEFAULT_SETUP_RULES.colorChangeMinutes,
    toolChangeMinutes: defaults.toolChangeMinutes ?? DEFAULT_SETUP_RULES.toolChangeMinutes,
    defaultMaterialChangeMinutes:
      defaults.defaultMaterialChangeMinutes ?? DEFAULT_SETUP_RULES.defaultMaterialChangeMinutes,
    materialMatrix: setupRules,
  };
}
