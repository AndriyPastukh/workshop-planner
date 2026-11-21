# Workshop Planner

Вебсистема розрахунку собівартості та планування черги виконання індивідуальних замовлень для локальної майстерні (3D-друк, лазерна порізка, столярка).

> Курсова робота з дисципліни «Вебтехнології та розробка вебзастосувань» (НУ «Львівська політехніка», група ОІ-31, 2026).

## Проблема та рішення

**Проблема:** невеликі майстерні витрачають багато часу на ручний прорахунок складних багатопозиційних замовлень і зривають дедлайни через неврахований час переналаштування обладнання (`setup / changeover`).

**Рішення:**
1. **Калькулятор собівартості та ціни** замовлення з розбивкою по матеріалу, роботі верстата, переналаштуванню, ручній праці, ризику браку, накладних витратах, маржі та націнках.
2. **Планувальник черги обладнання** (`FIFO`, `EDD`, `SPT`, `ATCS` Lee & Pinedo) із підтримкою календаря змін, матриці переналаштувань, закріплених (`locked`) робіт та перевірки «чи встигну до дати X».

## Технологічний стек

- **Frontend:** React 18, Vite, React Router, Tailwind CSS, TanStack Query, Recharts, власна діаграма Ганта на CSS Grid
- **Backend:** Node.js (≥ 20), Express, Zod, JWT + bcrypt, pino
- **База даних:** PostgreSQL + Prisma ORM
- **Тестування:** Vitest, Supertest
- **Деплой:** Render (Web Service + PostgreSQL)

## Структура репозиторію

```text
workshop-planner/
├── client/                    # React-застосунок (Vite)
│   └── src/
│       ├── components/        # перевикористовувані UI-компоненти
│       ├── pages/             # сторінки застосунку
│       ├── features/          # доменна клієнтська логіка
│       ├── lib/               # API-клієнт та клієнтські алгоритми
│       └── tests/             # клієнтські тести (Vitest)
├── server/                    # Express API та бізнес-логіка
│   ├── prisma/                # schema.prisma, міграції, seed
│   └── src/
│       ├── routes/            # контролери API
│       ├── services/          # сервісний шар (БД + domain)
│       ├── domain/            # чисті функції: pricing, setup, scheduler, feasibility
│       ├── middleware/        # auth, валідація, errorHandler
│       └── tests/             # модульні та API-тести
├── docs/                      # ТЗ, вимоги, записка, діаграми, тести, захист
├── scripts/                   # допоміжні скрипти (генерація звіту тощо)
├── .github/workflows/ci.yml   # CI pipeline (lint → test → build)
├── .env.example               # шаблон змінних середовища
├── CLAUDE.md                  # технічні правила та специфікація алгоритмів
└── PLAN.md                    # покроковий план розробки (фази 0–9)
```

## Налаштування середовища та локальної БД

1. Скопіюйте `.env.example` у `.env` і за потреби оновіть змінні:
   - **Основний локальний варіант (PostgreSQL 17 на порту `5432`):**
     `DATABASE_URL="postgresql://workshop_user:workshop_pass@localhost:5432/workshop?schema=public"`
   - **Альтернатива через Docker (PostgreSQL 16 на порту `5433`):**
     `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/workshop?schema=public"` та команда `npm run db:up` (контейнер описано в `docker-compose.yml`).
   - Інші змінні: `DB_PORT`, `JWT_SECRET`, `PORT` (`3001`), `NODE_ENV`.
2. Застосуйте міграції та засійте реалістичні демо-дані (якщо використовуєте Docker — спершу виконайте `npm run db:up`):
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
3. Демо-акаунти після `db:seed`:
   - **Власник (`owner`):** `owner@workshop.ua` / `Owner123!`
   - **Оператор (`operator`):** `operator@workshop.ua` / `Operator123!`

## Команди запуску

```bash
npm run install:all   # встановлення залежностей усіх workspace-пакетів
npm run db:up         # запуск локального PostgreSQL 16 у Docker (порт 5433)
npm run db:down       # зупинка контейнера PostgreSQL
npm run db:generate   # генерація Prisma Client
npm run db:migrate    # застосування міграцій БД (dev)
npm run db:seed       # ідемпотентне заповнення БД демо-даними
npm run dev           # одночасний запуск server (3001) і client (5173)
npm run lint          # перевірка коду ESLint
npm run test          # запуск тестів server і client
npm run build         # збірка клієнта у client/dist
npm start             # запуск production-сервера
npm run report        # генерація пояснювальної записки (налаштовується у Фазі 9)
```
