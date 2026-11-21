# PLAN.md — покроковий план для Claude Code

Читай разом із `CLAUDE.md`. Кожна фаза: **Що → Де → Як → Definition of Done (DoD) → Коміт**. Після кожної фази — короткий звіт студенту й питання, якщо бракує даних.
Розмір фази: S ≈ пів дня, M ≈ 1 день, L ≈ 2 дні (орієнтовно, для планування студента).

---

## Фаза 0 — Старт репозиторію (S)
**Що:** скелет проєкту, інструменти, документація-пустушки.
**Де:** корінь `workshop-planner/`.
**Як:**
1. `git init`, `.gitignore` (node_modules, .env, dist, *.log), `.editorconfig`, ESLint + Prettier.
2. Створити структуру з `CLAUDE.md §5` (порожні папки з `.gitkeep`).
3. Скопіювати вхідні файли студента в `docs/requirements/` (req.txt, my_topic.txt, критерії PDF, методичка PDF).
4. Кореневий `package.json` з усіма скриптами з `CLAUDE.md §5` (поки заглушки), `README.md` з назвою, описом задачі, стеком.
5. `.env.example` (`DATABASE_URL`, `JWT_SECRET`, `PORT`).
6. `.github/workflows/ci.yml`: install → lint → test → build.
**DoD:** `npm run install:all` працює; CI-файл валідний; структура відповідає §5.
**Коміт:** `chore: init repository structure`

## Фаза 1 — Технічне завдання і розділ 1 (M)
**Що:** ТЗ (Додаток В методички), Вступ, 1.1, 1.2.
**Де:** `docs/tz/`, `docs/report/01-intro.md`, `11-analysis.md`, `12-tools.md`.
**Як:**
1. Прочитай Додаток В методички → зроби ТЗ за зразком (мета, вимоги, функції, стек, етапи). Поля, яких не знаєш (керівник, дати) — `TODO(студент)`.
2. Вступ: актуальність (малі майстерні, зрив дедлайнів через setup), мета, завдання, об'єкт, предмет, методи.
3. 1.1: предметна область, бізнес-процес «від запиту клієнта до видачі», інформаційні потреби, ролі (власник, оператор), цільові метрики.
4. 1.2: порівняння ≥4 аналогів (Excel/Google Sheets, MRPeasy, Katana, онлайн-калькулятори 3D-друку тощо) за критеріями; обґрунтування стеку (React/Express/PostgreSQL/Render).
5. Через веб-пошук збери **≥15 джерел** (стаття про sequence-dependent setup scheduling, ATCS Lee & Pinedo, документація React/Express/Prisma/PostgreSQL, C4 model, UML, ДСТУ 8302:2015, тощо) → `docs/report/sources.md`, формат IEEE. Не вигадуй джерел: кожне має мати реальний URL/DOI, який ти відкрив.
**DoD:** ТЗ готове до друку й підпису; 1.1–1.2 мають висновок розділу; ≥15 перевірених джерел.
**Коміт:** `docs: add technical specification and chapter 1`

## Фаза 2 — Проєктування: діаграми і БД (M)
**Що:** розділ 2.1 + схема БД.
**Де:** `docs/diagrams/src`, `docs/report/21-design.md`, `server/prisma/schema.prisma`.
**Як:**
1. C4: Context, Container, Component (Mermaid/PlantUML) → PNG.
2. UML: Use Case (ролі: Власник, Оператор), Activity («створення замовлення і планування»), Sequence («розрахунок ціни», «перепланування черги»).
3. ER-діаграма за `CLAUDE.md §8`; нормалізація (до 3НФ) з коротким поясненням.
4. Реалізуй `schema.prisma`, першу міграцію, `seed.js` (2–3 верстати різних типів, 8–10 матеріалів, матриця setup, 15–20 демо-замовлень).
5. Кожну діаграму опиши текстом у 21-design.md (вимога методички: кожен блок схеми описаний).
**DoD:** `npm run db:migrate && npm run db:seed` проходить на чистій БД; усі діаграми є як код і PNG; розділ 2.1 з висновком.
**Коміт:** `feat(db): schema, migration, seed` + `docs: add design diagrams`

## Фаза 3 — Ядро: чиста бізнес-логіка + тести (L) ⭐ найважливіша
**Що:** `pricing`, `setup`, `scheduler`, `feasibility` без залежності від Express/БД.
**Де:** `server/src/domain/` + `server/src/tests/domain/`.
**Як:**
1. TDD: спершу ручно порахуй 3–4 еталонні приклади з числами (запиши у `docs/report/22-algorithms.md`), потім тести, потім код.
2. Реалізуй за `CLAUDE.md §7.1–7.4`. Сигнатури: `calculateItemCost(item, material, machine, settings)`, `setupTime(prev, next, machine, rules)`, `schedule(jobs, machines, rules, {rule, k1, k2, locked})`, `checkFeasibility(plan, newOrder, ...)`.
3. Метрики плану: запізнення, сумарний setup, завантаження, makespan.
4. Порівняльний тест: на одному наборі даних ATCS дає ≤ запізнень, ніж FIFO/EDD (зафіксуй набір, на якому це так, і поясни чому).
5. Блок-схема загального алгоритму (Mermaid) + блок-схема планувальника.
6. У 22-algorithms.md: формальний опис (формули з нумерацією (2.1), (2.2) …, пояснення символів «де»), складність O(n²·m) і чому.
**DoD:** coverage domain ≥ 90 %; усі еталонні приклади сходяться з ручним розрахунком; документ 2.2 містить формули, блок-схеми, приклади.
**Коміт:** `feat(domain): pricing, setup, scheduler, feasibility` + `docs: algorithms chapter`

## Фаза 4 — Backend API (M)
**Що:** REST API навколо domain.
**Де:** `server/src/routes|services|middleware`.
**Як:**
1. Auth: `POST /api/auth/login`, JWT, ролі `owner` / `operator`, middleware.
2. CRUD: machines, materials, customers, settings, setup_rules.
3. Orders: створення з позиціями, зміна статусу (state machine з перевіркою переходів), `POST /api/pricing/preview`.
4. Planner: `POST /api/schedule/rebuild?rule=ATCS`, `GET /api/schedule`, `PATCH /api/schedule/:id` (ручне переміщення/lock), `GET /api/schedule/compare`, `POST /api/quotes/feasibility`.
5. Списання матеріалу при `in_progress`, попередження про брак залишку.
6. Zod-валідація, єдиний errorHandler, rate-limit на login, CORS, helmet.
7. Swagger/OpenAPI опис у `docs/api.md` (стисло).
**DoD:** Supertest-тести на auth, orders, pricing, schedule, feasibility зелені; Postman-подібний сценарій у `docs/testing/api-scenario.md`.
**Коміт:** `feat(api): auth, crud, orders, planner endpoints`

## Фаза 5 — Frontend: каркас і спільні компоненти (M)
**Що:** React-застосунок, роутінг, дизайн-система.
**Де:** `client/src/`.
**Як:**
1. Vite + React Router + Tailwind + TanStack Query, api-клієнт з JWT, захищені маршрути.
2. Спільні компоненти (мінімум по **3+ використання кожен**): `DataTable` (замовлення, верстати, матеріали, клієнти), `StatusBadge`, `Modal/ConfirmDialog`, `FormField`, `PageHeader`, `StatCard`, `Money`. Занотуй у `docs/report/23-ui.md`, де саме кожна використана.
3. Адаптивний layout (sidebar → бургер на мобільному), Flex/Grid, перевірка 360/768/1280.
**DoD:** логін, навігація, порожні сторінки, мобільна версія працює; таблиця «компонент → де використано» заповнена.
**Коміт:** `feat(client): app shell and shared components`

## Фаза 6 — Frontend: сторінки і клієнтські алгоритми (L)
**Що:** 7+ сторінок.
**Як:**
1. **Dashboard** — KPI (замовлень у роботі, ризик запізнень, завантаження), графіки Recharts.
2. **Orders** + **OrderWizard** (клієнт → позиції → live-ціна з розбивкою → дедлайн → «чи встигну?» → підтвердження).
3. **OrderDetails** — позиції, собівартість, статус, історія.
4. **Planner** — діаграма Ганта (власна на CSS Grid), перетягування, lock, вибір правила (FIFO/EDD/SPT/ATCS), кнопка «Перепланувати», панель порівняння стратегій.
5. **Machines**, **Materials** (залишки, попередження), **Settings** (ставки, матриця setup).
6. **Analytics** — прибутковість по замовленнях/типах робіт, точність прогнозу.
7. Клієнтські алгоритми з `CLAUDE.md §7.5`; юніт-тести на них.
8. Друкована форма «Комерційна пропозиція» / «Наряд-завдання» (CSS print + «зберегти PDF») — для списку звітних форм у 2.3.
9. Стани loading/empty/error скрізь.
**DoD:** повний сценарій «клієнт → замовлення → ціна → план → виконано» проходиться вручну без помилок; скріни збережені в `docs/screenshots/`.
**Коміт:** по фічах: `feat(client): orders wizard`, `feat(client): planner gantt` …

## Фаза 7 — Деплой і автоматизація (S–M)
**Що:** публічний URL.
**Як:**
1. Express у production віддає `client/dist` і API з одного домену.
2. `npm run build` (client build), `npm start` (міграції `prisma migrate deploy` + старт).
3. `render.yaml` (Web Service + Postgres) або інструкція в `docs/deploy.md`. Студент сам створює акаунти Render/Neon і вставляє змінні — ти підготуй точні кроки.
4. Seed демо-даних на проді (окремий скрипт, без перезапису реальних даних).
5. Перевір: логін, створення замовлення, планувальник на проді. Додай health-check `/api/health`.
**DoD:** працююче посилання; README містить розділ «Деплой»; CI зелений.
**Коміт:** `chore: deployment config` + `docs: deploy guide`

## Фаза 8 — Тестування і розділ 3 (M)
**Що:** 3.1–3.4 записки.
**Як:**
1. 3.1 мінімальні параметри (Node 20, RAM, браузери, Postgres 14+).
2. 3.2 встановлення з нуля: **реально пройди за README на чистій папці** і виправ те, що ламається.
3. 3.3 інтерфейс: схема сторінок + покрокова робота на тестовому прикладі зі скрінами.
4. 3.4 тестування: таблиці (функціональне, нефункціональне, час планувальника на 50/200/500 робіт, адаптивність, безпека), результати прогонів.
**DoD:** розділ 3 з таблицями і скрінами; всі тести зелені; продуктивність зафіксована.
**Коміт:** `docs: chapter 3 and test results`

## Фаза 9 — Складання записки і захист (M)
**Що:** фінальний docx, презентація, підготовка до захисту.
**Як:**
1. `scripts/build-report.js`: збирає `docs/report/*.md` → `.docx` (pandoc + reference.docx: A4, 14 кегль, інтервал 1,5, поля 20/10/20/20 мм, нумерація сторінок справа вгорі, титулка без номера). Титулка за Додатком Б.
2. Автозміст, перелік скорочень, додатки (великі діаграми, екранні форми, звітні форми).
3. Перевірка за чек-листом критеріїв (`docs/defense/checklist.md`): кожен рядок таблиці оцінювання → де в проєкті виконано.
4. Презентація (10–12 слайдів): проблема → рішення → архітектура → алгоритми (ключове) → демо → тестування → висновки.
5. `docs/defense/QA.md`: 25+ питань і відповідей (чому ATCS, чому PostgreSQL, як працює setup-матриця, складність, що буде при 500 роботах, безпека, що зробив би далі).
6. Сценарій демо на 5 хвилин (`docs/defense/demo-script.md`).
**DoD:** docx відповідає вимогам оформлення; чек-лист закритий; студент пройшов QA і може пояснити кожен алгоритм.
**Коміт:** `docs: final report, presentation, defense materials`

---

## Що має зробити сам студент (не Claude Code)
- [ ] Забронювати тему в таблиці **до 22.11.2026** (колонка E → «Заброньована», F → ПІБ).
- [ ] Створити порожній репозиторій на GitHub, дати посилання → колонка G.
- [ ] Створити акаунти Render і Neon (фаза 7), додати посилання на деплой → колонка H.
- [ ] Дати Claude Code: ПІБ і посаду керівника, назву кафедри, терміни етапів, взірець титулки.
- [ ] Підписати ТЗ у викладача.
- [ ] Прочитати `docs/defense/QA.md` і прогнати демо вголос.
