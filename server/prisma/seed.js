import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import {
  DEFAULT_CALENDAR,
  calculateItemCost,
  calculateOrderTotals,
  compareStrategies,
  schedule,
} from '../src/domain/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

function getAnchorMondayUtc(now = new Date()) {
  const day = now.getUTCDay();
  const diffToMonday = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday, 9, 0, 0, 0)
  );
}

function addOffset(anchor, { days = 0, hours = 0, minutes = 0 } = {}) {
  const totalMs = ((days * 24 + hours) * 60 + minutes) * 60_000;
  return new Date(anchor.getTime() + totalMs);
}

const roundQty = (value) => Number(value.toFixed(3));

async function main() {
  const anchor = getAnchorMondayUtc();

  // Clean transactional data in FK-safe order to guarantee idempotency across repeated seeds.
  await prisma.auditLog.deleteMany();
  await prisma.scheduleEntry.deleteMany();
  await prisma.materialStockMovement.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.maintenanceWindow.deleteMany();
  await prisma.productTemplate.deleteMany();
  await prisma.setupRule.deleteMany();

  // 1. Settings
  const failureRates = {
    fdm_3d: 0.08,
    resin_3d: 0.12,
    laser: 0.02,
    cnc_wood: 0.03,
  };
  const volumeDiscounts = [
    { minQty: 5, discountPct: 0.05 },
    { minQty: 15, discountPct: 0.1 },
    { minQty: 30, discountPct: 0.15 },
  ];
  const setupDefaults = {
    baseMinutes: { fdm_3d: 10, resin_3d: 12, laser: 5, cnc_wood: 15 },
    warmupMinutes: { fdm_3d: 15, resin_3d: 10, laser: 5, cnc_wood: 10 },
    colorChangeMinutes: { fdm_3d: 8, resin_3d: 10, laser: 0, cnc_wood: 5 },
    toolChangeMinutes: { fdm_3d: 20, resin_3d: 15, laser: 10, cnc_wood: 15 },
    defaultMaterialChangeMinutes: { fdm_3d: 15, resin_3d: 25, laser: 8, cnc_wood: 10 },
  };

  const settings = await prisma.setting.upsert({
    where: { id: 'default' },
    update: {
      workshopName: 'Майстерня цифрового виробництва «ТехноЦех»',
      laborRate: 300,
      electricityRatePerKwh: 4.32,
      overheadPct: 0.15,
      marginPct: 0.3,
      rushSurcharge: 0.25,
      taxPct: 0.05,
      failureRates,
      volumeDiscounts,
      setupDefaults,
      atcsK1: 2.0,
      atcsK2: 0.5,
    },
    create: {
      id: 'default',
      workshopName: 'Майстерня цифрового виробництва «ТехноЦех»',
      laborRate: 300,
      electricityRatePerKwh: 4.32,
      overheadPct: 0.15,
      marginPct: 0.3,
      rushSurcharge: 0.25,
      taxPct: 0.05,
      failureRates,
      volumeDiscounts,
      setupDefaults,
      atcsK1: 2.0,
      atcsK2: 0.5,
    },
  });

  // 2. Users
  const ownerPasswordHash = await bcrypt.hash('Owner123!', 10);
  const operatorPasswordHash = await bcrypt.hash('Operator123!', 10);

  const owner = await prisma.user.upsert({
    where: { email: 'owner@workshop.ua' },
    update: { name: 'Андрій Пастух', role: 'owner', passwordHash: ownerPasswordHash },
    create: {
      email: 'owner@workshop.ua',
      name: 'Андрій Пастух',
      role: 'owner',
      passwordHash: ownerPasswordHash,
    },
  });

  const operator = await prisma.user.upsert({
    where: { email: 'operator@workshop.ua' },
    update: { name: 'Олег Коваль', role: 'operator', passwordHash: operatorPasswordHash },
    create: {
      email: 'operator@workshop.ua',
      name: 'Олег Коваль',
      role: 'operator',
      passwordHash: operatorPasswordHash,
    },
  });

  // 3. Machines (4 distinct equipment classes)
  const machineDefs = [
    {
      name: 'Bambu Lab X1C',
      type: 'fdm_3d',
      hourlyRate: 80,
      depreciationPerH: 78.49,
      powerKw: 0.35,
      calendar: DEFAULT_CALENDAR,
      notes: 'FDM 3D-принтер з AMS для інженерних пластиків',
    },
    {
      name: 'Elegoo Saturn 4 Ultra',
      type: 'resin_3d',
      hourlyRate: 110,
      depreciationPerH: 108.7,
      powerKw: 0.3,
      calendar: DEFAULT_CALENDAR,
      notes: 'MSLA фотополімерний принтер високої точності',
    },
    {
      name: 'CO2 Лазер 100W',
      type: 'laser',
      hourlyRate: 210,
      depreciationPerH: 201.36,
      powerKw: 2.0,
      calendar: DEFAULT_CALENDAR,
      notes: 'Лазерний розкрійник 1300×900 мм для фанери, акрилу, МДФ',
    },
    {
      name: 'ЧПК Фрезер 6090',
      type: 'cnc_wood',
      hourlyRate: 260,
      depreciationPerH: 247.04,
      powerKw: 3.0,
      calendar: DEFAULT_CALENDAR,
      notes: '3-осьовий фрезерний верстат з ЧПК для масиву деревини',
    },
  ];

  const machinesByType = {};
  for (const def of machineDefs) {
    const machine = await prisma.machine.upsert({
      where: { name: def.name },
      update: def,
      create: def,
    });
    machinesByType[def.type] = machine;
  }

  // Scheduled maintenance windows (next week)
  await prisma.maintenanceWindow.createMany({
    data: [
      {
        machineId: machinesByType.laser.id,
        title: 'Юстування дзеркал та чистка лінзи',
        start: addOffset(anchor, { days: 7, hours: 0 }),
        end: addOffset(anchor, { days: 7, hours: 2 }),
        notes: 'Планове тижневе обслуговування оптичного тракту',
      },
      {
        machineId: machinesByType.cnc_wood.id,
        title: 'Перевірка шпинделя та змащення напрямних',
        start: addOffset(anchor, { days: 8, hours: 3 }),
        end: addOffset(anchor, { days: 8, hours: 5 }),
        notes: 'Регламентне ТО після 100 годин роботи',
      },
    ],
  });

  // 4. Materials (12 materials in UAH; 2 intentionally below minStockQty for alerts)
  const materialDefs = [
    {
      code: 'PLA',
      name: 'Філамент PLA стандарт (чорний)',
      machineType: 'fdm_3d',
      color: 'чорний',
      unit: 'кг',
      pricePerUnit: 620,
      wastePct: 0.08,
      stockQty: 14.5,
      minStockQty: 4.0,
    },
    {
      code: 'PETG',
      name: 'Філамент PETG міцний (білий)',
      machineType: 'fdm_3d',
      color: 'білий',
      unit: 'кг',
      pricePerUnit: 740,
      wastePct: 0.1,
      stockQty: 9.2,
      minStockQty: 3.0,
    },
    {
      code: 'ABS',
      name: 'Філамент ABS інженерний (сірий)',
      machineType: 'fdm_3d',
      color: 'сірий',
      unit: 'кг',
      pricePerUnit: 820,
      wastePct: 0.12,
      stockQty: 1.4, // Low stock warning
      minStockQty: 3.5,
    },
    {
      code: 'TPU',
      name: 'Філамент TPU 95A гнучкий',
      machineType: 'fdm_3d',
      color: 'помаранчевий',
      unit: 'кг',
      pricePerUnit: 1150,
      wastePct: 0.12,
      stockQty: 4.8,
      minStockQty: 1.5,
    },
    {
      code: 'RESIN_STD',
      name: 'Фотополімерна смола Standard Grey',
      machineType: 'resin_3d',
      color: 'сірий',
      unit: 'л',
      pricePerUnit: 1250,
      wastePct: 0.12,
      stockQty: 6.0,
      minStockQty: 2.0,
    },
    {
      code: 'RESIN_TOUGH',
      name: 'Фотополімерна смола ABS-Like Tough',
      machineType: 'resin_3d',
      color: 'графіт',
      unit: 'л',
      pricePerUnit: 1680,
      wastePct: 0.14,
      stockQty: 0.5, // Deficit demo: confirmed WP-2026-026 requires 0.821 л > 0.5 л
      minStockQty: 2.0,
    },
    {
      code: 'PLY_4',
      name: 'Фанера березова 4 мм (сорт 1/2)',
      machineType: 'laser',
      color: 'натуральний',
      unit: 'м²',
      pricePerUnit: 380,
      wastePct: 0.1,
      stockQty: 28.0,
      minStockQty: 8.0,
    },
    {
      code: 'ACRYLIC_3',
      name: 'Акрил литий прозорий 3 мм',
      machineType: 'laser',
      color: 'прозорий',
      unit: 'м²',
      pricePerUnit: 890,
      wastePct: 0.08,
      stockQty: 12.5,
      minStockQty: 4.0,
    },
    {
      code: 'MDF_6',
      name: 'МДФ шліфований 6 мм',
      machineType: 'laser',
      color: 'бежевий',
      unit: 'м²',
      pricePerUnit: 320,
      wastePct: 0.09,
      stockQty: 18.0,
      minStockQty: 5.0,
    },
    {
      code: 'OAK_20',
      name: 'Щит дубовий 20 мм сухий',
      machineType: 'cnc_wood',
      color: 'дуб',
      unit: 'м²',
      pricePerUnit: 1950,
      wastePct: 0.12,
      stockQty: 8.4,
      minStockQty: 2.5,
    },
    {
      code: 'ASH_20',
      name: 'Щит ясеневий 20 мм',
      machineType: 'cnc_wood',
      color: 'ясен',
      unit: 'м²',
      pricePerUnit: 1580,
      wastePct: 0.11,
      stockQty: 6.2,
      minStockQty: 2.0,
    },
    {
      code: 'PINE_18',
      name: 'Щит сосновий 18 мм зрощений',
      machineType: 'cnc_wood',
      color: 'сосна',
      unit: 'м²',
      pricePerUnit: 760,
      wastePct: 0.1,
      stockQty: 15.0,
      minStockQty: 4.0,
    },
  ];

  const materialsByCode = {};
  for (const def of materialDefs) {
    const dataWithZeroReserve = { ...def, reservedQty: 0 };
    const mat = await prisma.material.upsert({
      where: { code: def.code },
      update: dataWithZeroReserve,
      create: dataWithZeroReserve,
    });
    materialsByCode[def.code] = mat;
  }

  // 5. Setup rules matrix (sequence-dependent changeover minutes)
  const setupRuleRows = [
    { machineType: 'fdm_3d', fromMaterial: 'PLA', toMaterial: 'PETG', minutes: 15 },
    { machineType: 'fdm_3d', fromMaterial: 'PETG', toMaterial: 'PLA', minutes: 20 },
    { machineType: 'fdm_3d', fromMaterial: 'PLA', toMaterial: 'ABS', minutes: 60 },
    { machineType: 'fdm_3d', fromMaterial: 'ABS', toMaterial: 'PLA', minutes: 60 },
    { machineType: 'fdm_3d', fromMaterial: 'PETG', toMaterial: 'ABS', minutes: 45 },
    { machineType: 'fdm_3d', fromMaterial: 'ABS', toMaterial: 'PETG', minutes: 40 },
    { machineType: 'fdm_3d', fromMaterial: 'PLA', toMaterial: 'TPU', minutes: 25 },
    { machineType: 'fdm_3d', fromMaterial: 'TPU', toMaterial: 'PLA', minutes: 35 },
    { machineType: 'resin_3d', fromMaterial: 'RESIN_STD', toMaterial: 'RESIN_TOUGH', minutes: 30 },
    { machineType: 'resin_3d', fromMaterial: 'RESIN_TOUGH', toMaterial: 'RESIN_STD', minutes: 35 },
    { machineType: 'laser', fromMaterial: 'PLY_4', toMaterial: 'ACRYLIC_3', minutes: 25 },
    { machineType: 'laser', fromMaterial: 'ACRYLIC_3', toMaterial: 'PLY_4', minutes: 20 },
    { machineType: 'laser', fromMaterial: 'PLY_4', toMaterial: 'MDF_6', minutes: 15 },
    { machineType: 'laser', fromMaterial: 'MDF_6', toMaterial: 'PLY_4', minutes: 15 },
    { machineType: 'laser', fromMaterial: 'ACRYLIC_3', toMaterial: 'MDF_6', minutes: 25 },
    { machineType: 'laser', fromMaterial: 'MDF_6', toMaterial: 'ACRYLIC_3', minutes: 25 },
    { machineType: 'cnc_wood', fromMaterial: 'OAK_20', toMaterial: 'PINE_18', minutes: 20 },
    { machineType: 'cnc_wood', fromMaterial: 'PINE_18', toMaterial: 'OAK_20', minutes: 30 },
    { machineType: 'cnc_wood', fromMaterial: 'OAK_20', toMaterial: 'ASH_20', minutes: 15 },
    { machineType: 'cnc_wood', fromMaterial: 'ASH_20', toMaterial: 'OAK_20', minutes: 15 },
  ];

  await prisma.setupRule.createMany({ data: setupRuleRows });

  // 6. Customers (8 realistic Ukrainian SMB/individual clients)
  const customerDefs = [
    {
      name: 'Тарас Мельник',
      company: 'ТОВ «Галич Дрон»',
      phone: '+380671122334',
      email: 'taras@galychdrone.ua',
    },
    {
      name: 'Ірина Савчук',
      company: 'Студія декору «Береза»',
      phone: '+380502233445',
      email: 'iryna@bereza-decor.ua',
    },
    {
      name: 'Максим Гончар',
      company: 'АгроСервіс Захід',
      phone: '+380633344556',
      email: 'm.honchar@agroservis.ua',
    },
    {
      name: 'Олена Бондар',
      company: 'Кав’ярня «Зерно»',
      phone: '+380974455667',
      email: 'olena@zerno.lviv.ua',
    },
    {
      name: 'Дмитро Кравченко',
      company: 'ФОП Кравченко (автоелектрика)',
      phone: '+380685566778',
      email: 'kravchenko.auto@gmail.com',
    },
    {
      name: 'Софія Левченко',
      company: 'Видавництво «Літера»',
      phone: '+380956677889',
      email: 'sofia@litera.ua',
    },
    {
      name: 'Віктор Яремчук',
      company: 'Спортивний клуб «Карпати»',
      phone: '+380667788990',
      email: 'viktor@karpaty-club.ua',
    },
    {
      name: 'Наталія Поліщук',
      company: 'Приватне замовлення',
      phone: '+380938899001',
      email: 'n.polishchuk@ukr.net',
    },
  ];

  const customers = [];
  for (const def of customerDefs) {
    const existing = await prisma.customer.findFirst({ where: { email: def.email } });
    if (existing) {
      customers.push(await prisma.customer.update({ where: { id: existing.id }, data: def }));
    } else {
      customers.push(await prisma.customer.create({ data: def }));
    }
  }

  // 7. Product templates (6 recurring workshop items)
  await prisma.productTemplate.createMany({
    data: [
      {
        name: 'Корпус сенсора DIN-рейка',
        machineType: 'fdm_3d',
        materialId: materialsByCode.PETG.id,
        usage: 0.085,
        runTimeH: 1.5,
        prepH: 0.25,
        postProcessH: 0.2,
        color: 'білий',
        tool: '0.4mm',
        defaultQty: 10,
      },
      {
        name: 'Шестерня редуктора модуля М1.5',
        machineType: 'fdm_3d',
        materialId: materialsByCode.ABS.id,
        usage: 0.06,
        runTimeH: 1.25,
        prepH: 0.2,
        postProcessH: 0.3,
        color: 'сірий',
        tool: '0.4mm',
        defaultQty: 6,
      },
      {
        name: 'Майстер-модель ювелірної форми',
        machineType: 'resin_3d',
        materialId: materialsByCode.RESIN_STD.id,
        usage: 0.04,
        runTimeH: 2.0,
        prepH: 0.3,
        postProcessH: 0.5,
        color: 'сірий',
        tool: '0.03mm',
        defaultQty: 4,
      },
      {
        name: 'Подарунковий короб із гравіюванням',
        machineType: 'laser',
        materialId: materialsByCode.PLY_4.id,
        usage: 0.35,
        runTimeH: 0.4,
        prepH: 0.25,
        postProcessH: 0.25,
        color: 'натуральний',
        tool: '2in',
        defaultQty: 15,
      },
      {
        name: 'Акриловий цінникотримач А5',
        machineType: 'laser',
        materialId: materialsByCode.ACRYLIC_3.id,
        usage: 0.14,
        runTimeH: 0.25,
        prepH: 0.15,
        postProcessH: 0.2,
        color: 'прозорий',
        tool: '2in',
        defaultQty: 20,
      },
      {
        name: 'Менажниця дубова 300 мм',
        machineType: 'cnc_wood',
        materialId: materialsByCode.OAK_20.id,
        usage: 0.12,
        runTimeH: 0.9,
        prepH: 0.3,
        postProcessH: 0.6,
        color: 'дуб',
        tool: '6mm_ball',
        defaultQty: 5,
      },
    ],
  });

  // 8. 28 Realistic Orders across all statuses and 4 machine types
  // Note: active orders (in_progress + confirmed) are calibrated so FIFO/EDD incur several
  // avoidable delays from material switching, while ATCS groups materials and reduces tardiness.
  const orderSpecs = [
    // 5 done (historical completed orders)
    {
      code: 'WP-2026-001',
      customerIdx: 0,
      status: 'done',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: -5, hours: 6 }),
      items: [
        { title: 'Кронштейн камери v2', mat: 'PETG', qty: 8, usage: 0.05, runTimeH: 0.8, prepH: 0.25, postH: 0.25 },
      ],
    },
    {
      code: 'WP-2026-002',
      customerIdx: 1,
      status: 'done',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: -4, hours: 8 }),
      items: [
        { title: 'Топери святкові фанерні', mat: 'PLY_4', qty: 25, usage: 0.08, runTimeH: 0.15, prepH: 0.25, postH: 0.3 },
      ],
    },
    {
      code: 'WP-2026-003',
      customerIdx: 3,
      status: 'done',
      priority: 2,
      isRush: true,
      deadline: addOffset(anchor, { days: -3, hours: 5 }),
      items: [
        { title: 'Підставка меню дубова', mat: 'OAK_20', qty: 10, usage: 0.09, runTimeH: 0.5, prepH: 0.3, postH: 0.5 },
      ],
    },
    {
      code: 'WP-2026-004',
      customerIdx: 4,
      status: 'done',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: -2, hours: 7 }),
      items: [
        { title: 'Корпус роз’єму OBD', mat: 'ABS', qty: 4, usage: 0.04, runTimeH: 0.9, prepH: 0.2, postH: 0.2 },
      ],
    },
    {
      code: 'WP-2026-005',
      customerIdx: 5,
      status: 'done',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: -1, hours: 6 }),
      items: [
        { title: 'Стенд акриловий А4', mat: 'ACRYLIC_3', qty: 6, usage: 0.22, runTimeH: 0.3, prepH: 0.2, postH: 0.25 },
        { title: 'Фіксатор банера PLA', mat: 'PLA', qty: 12, usage: 0.03, runTimeH: 0.35, prepH: 0.15, postH: 0.15 },
      ],
    },
    // 2 cancelled
    {
      code: 'WP-2026-006',
      customerIdx: 7,
      status: 'cancelled',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 3, hours: 8 }),
      items: [
        { title: 'Декоративна табличка МДФ', mat: 'MDF_6', qty: 4, usage: 0.25, runTimeH: 0.4, prepH: 0.2, postH: 0.2 },
      ],
    },
    {
      code: 'WP-2026-007',
      customerIdx: 6,
      status: 'cancelled',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 4, hours: 4 }),
      items: [
        { title: 'Брелок силікон-лайк TPU', mat: 'TPU', qty: 20, usage: 0.02, runTimeH: 0.25, prepH: 0.2, postH: 0.2 },
      ],
    },
    // 3 draft
    {
      code: 'WP-2026-008',
      customerIdx: 2,
      status: 'draft',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 8, hours: 8 }),
      items: [
        { title: 'Захисний кожух датчика', mat: 'PETG', qty: 5, usage: 0.11, runTimeH: 1.4, prepH: 0.25, postH: 0.25 },
      ],
    },
    {
      code: 'WP-2026-009',
      customerIdx: 1,
      status: 'draft',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 9, hours: 6 }),
      items: [
        { title: 'Шкатулка з кришкою (ясен)', mat: 'ASH_20', qty: 3, usage: 0.18, runTimeH: 1.2, prepH: 0.3, postH: 0.5 },
      ],
    },
    {
      code: 'WP-2026-010',
      customerIdx: 5,
      status: 'draft',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 10, hours: 8 }),
      items: [
        { title: 'Прототип статуетки 75 мм', mat: 'RESIN_STD', qty: 2, usage: 0.08, runTimeH: 2.5, prepH: 0.3, postH: 0.5 },
      ],
    },
    // 4 quoted
    {
      code: 'WP-2026-011',
      customerIdx: 0,
      status: 'quoted',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 6, hours: 8 }),
      items: [
        { title: 'Бортовий відсік телеметрії', mat: 'ABS', qty: 4, usage: 0.09, runTimeH: 1.6, prepH: 0.25, postH: 0.3 },
      ],
    },
    {
      code: 'WP-2026-012',
      customerIdx: 3,
      status: 'quoted',
      priority: 2,
      isRush: true,
      deadline: addOffset(anchor, { days: 5, hours: 5 }),
      items: [
        { title: 'Табличка гравійована акрил', mat: 'ACRYLIC_3', qty: 8, usage: 0.15, runTimeH: 0.35, prepH: 0.2, postH: 0.2 },
      ],
    },
    {
      code: 'WP-2026-013',
      customerIdx: 6,
      status: 'quoted',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 7, hours: 7 }),
      items: [
        { title: 'Кубок дерев’яний на підставці', mat: 'OAK_20', qty: 6, usage: 0.14, runTimeH: 0.9, prepH: 0.3, postH: 0.6 },
        { title: 'Шильд лазерний акриловий', mat: 'ACRYLIC_3', qty: 6, usage: 0.04, runTimeH: 0.15, prepH: 0.1, postH: 0.1 },
      ],
    },
    {
      code: 'WP-2026-014',
      customerIdx: 7,
      status: 'quoted',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 8, hours: 4 }),
      items: [
        { title: 'Мініатюра для настільної гри', mat: 'RESIN_TOUGH', qty: 6, usage: 0.03, runTimeH: 0.8, prepH: 0.25, postH: 0.4 },
      ],
    },
    // 4 in_progress (one per machine class, placed at start of schedule, 2 locked)
    {
      code: 'WP-2026-015',
      customerIdx: 0,
      status: 'in_progress',
      priority: 3,
      isRush: true,
      locked: true,
      deadline: addOffset(anchor, { days: 0, hours: 4 }),
      items: [
        { title: 'Тримач антени карбон-PLA', mat: 'PLA', qty: 3, usage: 0.05, runTimeH: 0.7, prepH: 0.2, postH: 0.2 },
      ],
    },
    {
      code: 'WP-2026-016',
      customerIdx: 4,
      status: 'in_progress',
      priority: 3,
      isRush: false,
      locked: true,
      deadline: addOffset(anchor, { days: 0, hours: 6 }),
      items: [
        { title: 'Шестерня точна (фотополімер)', mat: 'RESIN_STD', qty: 4, usage: 0.03, runTimeH: 0.75, prepH: 0.2, postH: 0.3 },
      ],
    },
    {
      code: 'WP-2026-017',
      customerIdx: 1,
      status: 'in_progress',
      priority: 2,
      isRush: false,
      deadline: addOffset(anchor, { days: 0, hours: 5 }),
      items: [
        { title: 'Короб подарунковий (партія)', mat: 'PLY_4', qty: 6, usage: 0.3, runTimeH: 0.35, prepH: 0.2, postH: 0.25 },
      ],
    },
    {
      code: 'WP-2026-018',
      customerIdx: 3,
      status: 'in_progress',
      priority: 2,
      isRush: false,
      deadline: addOffset(anchor, { days: 0, hours: 7 }),
      items: [
        { title: 'Дошка сервірувальна дуб', mat: 'OAK_20', qty: 3, usage: 0.16, runTimeH: 0.9, prepH: 0.25, postH: 0.5 },
      ],
    },
    // 10 confirmed (active queue with alternating materials & tight deadlines for scheduler)
    {
      code: 'WP-2026-019',
      customerIdx: 2,
      status: 'confirmed',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 1, hours: 7 }),
      items: [
        { title: 'Корпус блоку керування ABS', mat: 'ABS', qty: 2, usage: 0.14, runTimeH: 1.5, prepH: 0.25, postH: 0.3 },
      ],
    },
    {
      code: 'WP-2026-020',
      customerIdx: 0,
      status: 'confirmed',
      priority: 2,
      isRush: false,
      deadline: addOffset(anchor, { days: 0, hours: 5, minutes: 30 }),
      items: [
        { title: 'Направляюча сервоприводу PLA', mat: 'PLA', qty: 4, usage: 0.04, runTimeH: 0.45, prepH: 0.15, postH: 0.15 },
      ],
    },
    {
      code: 'WP-2026-021',
      customerIdx: 5,
      status: 'confirmed',
      priority: 2,
      isRush: true,
      deadline: addOffset(anchor, { days: 0, hours: 7, minutes: 30 }),
      items: [
        { title: 'Органайзер прозорий акрил', mat: 'ACRYLIC_3', qty: 4, usage: 0.2, runTimeH: 0.35, prepH: 0.2, postH: 0.2 },
      ],
    },
    {
      code: 'WP-2026-022',
      customerIdx: 1,
      status: 'confirmed',
      priority: 3,
      isRush: true,
      deadline: addOffset(anchor, { days: 0, hours: 8 }),
      items: [
        { title: 'Декор фанерний (терміново)', mat: 'PLY_4', qty: 5, usage: 0.25, runTimeH: 0.25, prepH: 0.15, postH: 0.2 },
      ],
    },
    {
      code: 'WP-2026-023',
      customerIdx: 4,
      status: 'confirmed',
      priority: 2,
      isRush: false,
      deadline: addOffset(anchor, { days: 0, hours: 8, minutes: 30 }),
      items: [
        { title: 'Адаптер кабелю PLA-чорний', mat: 'PLA', qty: 3, usage: 0.05, runTimeH: 0.5, prepH: 0.15, postH: 0.15 },
      ],
    },
    {
      code: 'WP-2026-024',
      customerIdx: 6,
      status: 'confirmed',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 1, hours: 5 }),
      items: [
        { title: 'Табличка номерна МДФ', mat: 'MDF_6', qty: 10, usage: 0.12, runTimeH: 0.2, prepH: 0.2, postH: 0.2 },
        { title: 'Тримач медалей сосна', mat: 'PINE_18', qty: 4, usage: 0.15, runTimeH: 0.7, prepH: 0.25, postH: 0.4 },
      ],
    },
    {
      code: 'WP-2026-025',
      customerIdx: 2,
      status: 'confirmed',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 1, hours: 5 }),
      items: [
        { title: 'Форсунка оприскувача PETG', mat: 'PETG', qty: 6, usage: 0.03, runTimeH: 0.4, prepH: 0.2, postH: 0.2 },
      ],
    },
    {
      code: 'WP-2026-026',
      customerIdx: 7,
      status: 'confirmed',
      priority: 1,
      isRush: false,
      deadline: addOffset(anchor, { days: 2, hours: 4 }),
      items: [
        { title: 'Корпус електроніки ударостійкий', mat: 'RESIN_TOUGH', qty: 6, usage: 0.12, runTimeH: 0.5, prepH: 0.25, postH: 0.5 },
      ],
    },
    {
      code: 'WP-2026-027',
      customerIdx: 3,
      status: 'confirmed',
      priority: 2,
      isRush: false,
      deadline: addOffset(anchor, { days: 1, hours: 8 }),
      items: [
        { title: 'Таця дубова фрезерована', mat: 'OAK_20', qty: 4, usage: 0.18, runTimeH: 0.85, prepH: 0.25, postH: 0.5 },
      ],
    },
    {
      code: 'WP-2026-028',
      customerIdx: 4,
      status: 'confirmed',
      priority: 3,
      isRush: false,
      deadline: addOffset(anchor, { days: 1, hours: 5 }), // Tight deadline for overdue demo
      items: [
        { title: 'Тестова матриця ABS (терміновий зразок)', mat: 'ABS', qty: 3, usage: 0.08, runTimeH: 1.2, prepH: 0.2, postH: 0.3 },
        { title: 'Віконце індикаторне акрил', mat: 'ACRYLIC_3', qty: 3, usage: 0.05, runTimeH: 0.2, prepH: 0.1, postH: 0.1 },
      ],
    },
  ];

  const activeJobsForScheduler = [];
  const lockedOrderCodes = new Set(['WP-2026-015', 'WP-2026-016']);
  const overrunDoneCodes = new Set(['WP-2026-001', 'WP-2026-003']);
  const createdOrders = [];
  const movementRows = [];
  const orderAuditRows = [];
  const reservedByMat = {};
  const consumedByMat = {};
  const wasteByMat = {};
  const adjustByMat = {};

  for (const spec of orderSpecs) {
    const customer = customers[spec.customerIdx];
    const itemCalculations = [];

    for (const itemSpec of spec.items) {
      const material = materialsByCode[itemSpec.mat];
      const machine = machinesByType[material.machineType];

      const calc = calculateItemCost(
        {
          qty: itemSpec.qty,
          usage: itemSpec.usage,
          runTimeH: itemSpec.runTimeH,
          setupTimeH: 0.25,
          batchShare: 1,
          prepH: itemSpec.prepH,
          postProcessH: itemSpec.postH,
          isRush: spec.isRush,
        },
        { pricePerUnit: material.pricePerUnit, wastePct: material.wastePct, unit: material.unit },
        { hourlyRate: machine.hourlyRate },
        {
          laborRate: settings.laborRate,
          failureRate: failureRates[material.machineType],
          overheadPct: settings.overheadPct,
          marginPct: settings.marginPct,
          rushSurcharge: settings.rushSurcharge,
          taxPct: settings.taxPct,
          electricityRatePerKwh: settings.electricityRatePerKwh,
          volumeDiscounts,
        }
      );

      const plannedMaterialQty = roundQty(itemSpec.qty * itemSpec.usage * (1 + material.wastePct));
      let actualMaterialQty = null;
      if (spec.status === 'done') {
        actualMaterialQty = overrunDoneCodes.has(spec.code)
          ? roundQty(plannedMaterialQty * 1.07)
          : plannedMaterialQty;
      } else if (spec.status === 'in_progress') {
        actualMaterialQty = plannedMaterialQty;
      }

      itemCalculations.push({
        itemSpec,
        material,
        machine,
        calc,
        plannedMaterialQty,
        actualMaterialQty,
      });
    }

    const orderTotals = calculateOrderTotals(itemCalculations.map((x) => x.calc));

    const order = await prisma.order.create({
      data: {
        code: spec.code,
        customerId: customer.id,
        deadline: spec.deadline,
        priority: spec.priority,
        status: spec.status,
        isRush: spec.isRush,
        rushSurcharge: spec.isRush ? settings.rushSurcharge : 0,
        totalCost: orderTotals.cost,
        totalPrice: orderTotals.price,
        items: {
          create: itemCalculations.map(
            ({ itemSpec, material, calc, plannedMaterialQty, actualMaterialQty }) => ({
              title: itemSpec.title,
              machineType: material.machineType,
              materialId: material.id,
              color: material.color,
              tool: material.machineType === 'fdm_3d' ? '0.4mm' : 'std',
              usage: itemSpec.usage,
              runTimeH: itemSpec.runTimeH,
              prepH: itemSpec.prepH,
              postProcessH: itemSpec.postH,
              qty: itemSpec.qty,
              batchShare: 1,
              setupMin: 15,
              plannedMaterialQty,
              actualMaterialQty,
              cost: calc.breakdown.cost,
              price: calc.breakdown.price,
              pricingBreakdown: {
                ...calc.breakdown,
                raw: calc.raw,
                appliedRates: calc.appliedRates,
                inputs: calc.inputs,
              },
            })
          ),
        },
      },
      include: { items: true },
    });

    createdOrders.push(order);

    // Seed chronological status & audit history for OrderDetails timeline
    orderAuditRows.push({
      userId: owner.id,
      action: 'ORDER_CREATED',
      entity: 'order',
      entityId: order.id,
      payload: { code: order.code, status: 'draft', totalPrice: order.totalPrice },
      createdAt: addOffset(anchor, { days: -7 }),
    });
    if (order.status === 'quoted') {
      orderAuditRows.push({
        userId: operator.id,
        action: 'ORDER_STATUS_CHANGED',
        entity: 'order',
        entityId: order.id,
        payload: { from: 'draft', to: 'quoted' },
        createdAt: addOffset(anchor, { days: -6 }),
      });
    } else if (order.status === 'confirmed') {
      orderAuditRows.push({
        userId: operator.id,
        action: 'ORDER_STATUS_CHANGED',
        entity: 'order',
        entityId: order.id,
        payload: { from: 'draft', to: 'confirmed' },
        createdAt: addOffset(anchor, { days: -1 }),
      });
    } else if (order.status === 'in_progress') {
      orderAuditRows.push(
        {
          userId: operator.id,
          action: 'ORDER_STATUS_CHANGED',
          entity: 'order',
          entityId: order.id,
          payload: { from: 'draft', to: 'confirmed' },
          createdAt: addOffset(anchor, { days: -1 }),
        },
        {
          userId: operator.id,
          action: 'ORDER_STATUS_CHANGED',
          entity: 'order',
          entityId: order.id,
          payload: { from: 'confirmed', to: 'in_progress' },
          createdAt: addOffset(anchor, { hours: -2 }),
        }
      );
    } else if (order.status === 'done') {
      orderAuditRows.push(
        {
          userId: operator.id,
          action: 'ORDER_STATUS_CHANGED',
          entity: 'order',
          entityId: order.id,
          payload: { from: 'draft', to: 'confirmed' },
          createdAt: addOffset(order.deadline, { days: -2 }),
        },
        {
          userId: operator.id,
          action: 'ORDER_STATUS_CHANGED',
          entity: 'order',
          entityId: order.id,
          payload: { from: 'confirmed', to: 'in_progress' },
          createdAt: addOffset(order.deadline, { hours: -6 }),
        },
        {
          userId: operator.id,
          action: 'ORDER_STATUS_CHANGED',
          entity: 'order',
          entityId: order.id,
          payload: { from: 'in_progress', to: 'done' },
          createdAt: order.deadline,
        }
      );
    } else if (order.status === 'cancelled') {
      if (order.code === 'WP-2026-006') {
        orderAuditRows.push(
          {
            userId: operator.id,
            action: 'ORDER_STATUS_CHANGED',
            entity: 'order',
            entityId: order.id,
            payload: { from: 'draft', to: 'confirmed' },
            createdAt: addOffset(anchor, { days: -2 }),
          },
          {
            userId: owner.id,
            action: 'ORDER_STATUS_CHANGED',
            entity: 'order',
            entityId: order.id,
            payload: { from: 'confirmed', to: 'cancelled' },
            createdAt: addOffset(anchor, { days: -1 }),
          }
        );
      } else {
        orderAuditRows.push({
          userId: owner.id,
          action: 'ORDER_STATUS_CHANGED',
          entity: 'order',
          entityId: order.id,
          payload: { from: 'draft', to: 'cancelled' },
          createdAt: addOffset(anchor, { days: -1 }),
        });
      }
    }

    // Record typed stock movements across order lifecycle statuses.
    for (const item of order.items) {
      const matCode = spec.items.find((i) => i.title === item.title).mat;
      const planned = item.plannedMaterialQty;

      if (order.status === 'done') {
        consumedByMat[matCode] = roundQty((consumedByMat[matCode] ?? 0) + planned);
        movementRows.push({
          materialId: item.materialId,
          orderId: order.id,
          orderItemId: item.id,
          userId: operator.id,
          type: 'consume',
          qty: planned,
          comment: `Списано за виконаним замовленням (${order.code})`,
          createdAt: addOffset(order.deadline, { hours: -6 }),
        });

        const wasteQty = roundQty((item.actualMaterialQty ?? planned) - planned);
        if (wasteQty > 0) {
          wasteByMat[matCode] = roundQty((wasteByMat[matCode] ?? 0) + wasteQty);
          movementRows.push({
            materialId: item.materialId,
            orderId: order.id,
            orderItemId: item.id,
            userId: operator.id,
            type: 'waste',
            qty: wasteQty,
            comment: `Технологічні відходи за фактом виконання (${order.code})`,
            createdAt: order.deadline,
          });
        }
      } else if (order.status === 'in_progress') {
        consumedByMat[matCode] = roundQty((consumedByMat[matCode] ?? 0) + planned);
        movementRows.push(
          {
            materialId: item.materialId,
            orderId: order.id,
            orderItemId: item.id,
            userId: operator.id,
            type: 'reserve',
            qty: planned,
            comment: `Резерв під замовлення (${order.code})`,
            createdAt: addOffset(anchor, { days: -1 }),
          },
          {
            materialId: item.materialId,
            orderId: order.id,
            orderItemId: item.id,
            userId: operator.id,
            type: 'release',
            qty: planned,
            comment: `Зняття резерву при запуску в роботу (${order.code})`,
            createdAt: addOffset(anchor, { hours: -2 }),
          },
          {
            materialId: item.materialId,
            orderId: order.id,
            orderItemId: item.id,
            userId: operator.id,
            type: 'consume',
            qty: planned,
            comment: `Списано у виробництво (${order.code})`,
            createdAt: addOffset(anchor, { hours: -2 }),
          }
        );
      } else if (order.status === 'confirmed') {
        reservedByMat[matCode] = roundQty((reservedByMat[matCode] ?? 0) + planned);
        movementRows.push({
          materialId: item.materialId,
          orderId: order.id,
          orderItemId: item.id,
          userId: operator.id,
          type: 'reserve',
          qty: planned,
          comment: `Резерв під підтверджене замовлення (${order.code})`,
          createdAt: addOffset(anchor, { days: -1 }),
        });
      } else if (order.status === 'cancelled' && order.code === 'WP-2026-006') {
        movementRows.push(
          {
            materialId: item.materialId,
            orderId: order.id,
            orderItemId: item.id,
            userId: operator.id,
            type: 'reserve',
            qty: planned,
            comment: `Резерв до скасування замовлення (${order.code})`,
            createdAt: addOffset(anchor, { days: -2 }),
          },
          {
            materialId: item.materialId,
            orderId: order.id,
            orderItemId: item.id,
            userId: operator.id,
            type: 'release',
            qty: planned,
            comment: `Зняття резерву при скасуванні (${order.code})`,
            createdAt: addOffset(anchor, { days: -1 }),
          }
        );
      }
    }

    if (order.status === 'in_progress' || order.status === 'confirmed') {
      for (const item of order.items) {
        const matEntry = Object.values(materialsByCode).find((m) => m.id === item.materialId);
        activeJobsForScheduler.push({
          id: item.id,
          orderId: order.id,
          orderCode: order.code,
          machineType: item.machineType,
          material: matEntry.code,
          color: item.color,
          tool: item.tool,
          processingTimeMin: Math.max(15, Math.round(item.qty * item.runTimeH * 60)),
          deadline: order.deadline.toISOString(),
          priority: order.priority,
          _locked: lockedOrderCodes.has(order.code),
        });
      }
    }
  }

  // 8b. Balanced receipts, inventory adjustment, and exact reservedQty sync
  adjustByMat.PLA = -0.2;
  movementRows.push({
    materialId: materialsByCode.PLA.id,
    userId: owner.id,
    type: 'adjustment',
    qty: -0.2,
    comment: 'Інвентаризація складу: корекція залишку котушки',
    createdAt: addOffset(anchor, { days: -3 }),
  });

  const twoReceiptCodes = new Set(['PLA', 'PLY_4']);
  const lowStockList = [];
  const deficitList = [];

  for (const def of materialDefs) {
    const mat = materialsByCode[def.code];
    const reserved = roundQty(reservedByMat[def.code] ?? 0);
    const consumed = roundQty(consumedByMat[def.code] ?? 0);
    const waste = roundQty(wasteByMat[def.code] ?? 0);
    const adjust = roundQty(adjustByMat[def.code] ?? 0);
    const totalReceipt = roundQty(mat.stockQty + consumed + waste - adjust);

    if (twoReceiptCodes.has(def.code)) {
      const firstQty = roundQty(totalReceipt * 0.7);
      const secondQty = roundQty(totalReceipt - firstQty);
      movementRows.push(
        {
          materialId: mat.id,
          userId: owner.id,
          type: 'receipt',
          qty: firstQty,
          comment: 'Початковий прихід на склад',
          createdAt: addOffset(anchor, { days: -14 }),
        },
        {
          materialId: mat.id,
          userId: owner.id,
          type: 'receipt',
          qty: secondQty,
          comment: 'Поповнення складу від постачальника',
          createdAt: addOffset(anchor, { days: -4 }),
        }
      );
    } else {
      movementRows.push({
        materialId: mat.id,
        userId: owner.id,
        type: 'receipt',
        qty: totalReceipt,
        comment: 'Початковий прихід на склад',
        createdAt: addOffset(anchor, { days: -10 }),
      });
    }

    await prisma.material.update({
      where: { id: mat.id },
      data: { reservedQty: reserved },
    });

    const available = roundQty(mat.stockQty - reserved);
    if (available < 0) {
      deficitList.push(`${mat.code}(avail=${available})`);
    } else if (available <= mat.minStockQty) {
      lowStockList.push(`${mat.code}(avail=${available})`);
    }
  }

  await prisma.materialStockMovement.createMany({ data: movementRows });

  const movementCountsByType = movementRows.reduce((acc, row) => {
    acc[row.type] = (acc[row.type] ?? 0) + 1;
    return acc;
  }, {});

  // 9. Build schedule using domain ATCS & compare strategies
  const domainMachines = Object.values(machinesByType).map((m) => ({
    id: m.id,
    type: m.type,
    calendar: m.calendar,
  }));
  const domainRules = {
    ...setupDefaults,
    materialMatrix: setupRuleRows,
  };

  // Lock the first two in_progress jobs right at shift start on their machines
  const lockedWindows = [];
  for (const job of activeJobsForScheduler.filter((j) => j._locked)) {
    const machine = domainMachines.find((m) => m.type === job.machineType);
    const setupMin =
      (setupDefaults.baseMinutes[machine.type] ?? 10) +
      (setupDefaults.warmupMinutes[machine.type] ?? 10);
    const setupStart = anchor;
    const setupEnd = addOffset(setupStart, { minutes: setupMin });
    const end = addOffset(setupEnd, { minutes: job.processingTimeMin });
    lockedWindows.push({
      jobId: job.id,
      machineId: machine.id,
      setupStart: setupStart.toISOString(),
      setupEnd: setupEnd.toISOString(),
      start: setupEnd.toISOString(),
      end: end.toISOString(),
      setupMin,
    });
  }

  const comparison = compareStrategies(activeJobsForScheduler, domainMachines, domainRules, {
    startTime: anchor.toISOString(),
    k1: settings.atcsK1,
    k2: settings.atcsK2,
    locked: lockedWindows,
  });

  const atcsPlan = schedule(activeJobsForScheduler, domainMachines, domainRules, {
    rule: 'ATCS',
    startTime: anchor.toISOString(),
    k1: settings.atcsK1,
    k2: settings.atcsK2,
    locked: lockedWindows,
  });

  await prisma.scheduleEntry.createMany({
    data: atcsPlan.entries.map((entry) => ({
      orderItemId: entry.jobId,
      machineId: entry.machineId,
      setupStart: new Date(entry.setupStart),
      setupEnd: new Date(entry.setupEnd),
      start: new Date(entry.start),
      end: new Date(entry.end),
      setupMin: entry.setupMin,
      processingMin: entry.processingMin,
      latenessMin: entry.latenessMin,
      tardinessMin: entry.tardinessMin,
      locked: entry.locked,
      ruleUsed: 'ATCS',
    })),
  });

  await prisma.auditLog.createMany({ data: orderAuditRows });

  await prisma.auditLog.create({
    data: {
      userId: owner.id,
      action: 'SEED_INITIALIZED',
      entity: 'system',
      payload: {
        ordersCount: createdOrders.length,
        activeJobsCount: activeJobsForScheduler.length,
        strategyMetrics: comparison.strategies,
      },
    },
  });

  console.log('Seed completed:');
  console.log(`- Machines: ${Object.keys(machinesByType).length}`);
  console.log(`- Materials: ${Object.keys(materialsByCode).length}`);
  console.log(`- Stock movements (${movementRows.length}): ${JSON.stringify(movementCountsByType)}`);
  console.log(`- Low-stock materials: ${lowStockList.join(', ') || 'none'}`);
  console.log(`- Deficit materials: ${deficitList.join(', ') || 'none'}`);
  console.log(`- Customers: ${customers.length}`);
  console.log(`- Orders: ${createdOrders.length}`);
  console.log(`- Schedule entries (ATCS): ${atcsPlan.entries.length}`);
  console.log('Strategy comparison on seeded active queue:');
  for (const [name, m] of Object.entries(comparison.strategies)) {
    console.log(
      `  ${name.padEnd(4)} | late=${m.lateCount} | tardiness=${m.totalTardinessMin}m | setup=${m.totalSetupMin}m | makespan=${m.makespanMin}m`
    );
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
