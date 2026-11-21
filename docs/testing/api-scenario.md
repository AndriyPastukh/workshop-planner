# Тестовий сценарій REST API (наскрізний HTTP-потік)

Сценарій відповідає Postman/Supertest-перевірці та реалізований автоматично в [api.test.js](../../server/src/tests/api/api.test.js).

1. **Перевірка доступності:** `GET /api/health` → `200 { status: "ok" }`.
2. **Авторизація:** `POST /api/auth/login` (`owner@workshop.ua` / `Owner123!`) → отримання `JWT` і профілю.
3. **Захист маршрутів і RBAC:** запит `GET /api/orders` без токена → `401 UNAUTHORIZED`; `PATCH /api/settings` під роллю `operator` → `403 FORBIDDEN`.
4. **Попередній розрахунок ціни (без запису в БД):** `POST /api/pricing/preview` з позиціями замовлення → розбивка `material / machine / setup / labor / withRisk / cost / price`.
5. **Перевірка здійсненності («чи встигну?»):** `POST /api/quotes/feasibility` → рекомендація (`ACCEPT_STANDARD` / `ACCEPT_WITH_RUSH` / `NEGOTIATE_DEADLINE`), `earliestFinish`, `shiftedOrders`.
6. **Створення замовлення та переходи статусів:** `POST /api/orders` → нелегальний перехід `draft → done` (`409 INVALID_STATUS_TRANSITION`) → `draft → quoted → confirmed → in_progress` (`200`, списання залишку матеріалу і попередження `LOW_STOCK`).
7. **Порівняння стратегій і перепланування:** `GET /api/schedule/compare` (метрики `FIFO/EDD/SPT/ATCS`) → `POST /api/schedule/rebuild?rule=ATCS` (збереження `locked`-робіт).
8. **Ручне перетягування і конфлікт:** `PATCH /api/schedule/:id` на зайнятий слот → `409 SCHEDULE_CONFLICT`; на вільний час + `locked: true` → `200 OK`.
9. **Аналітика:** `GET /api/analytics/dashboard` і `GET /api/analytics/summary` → зведені KPI, прибуток по верстатах і клієнтах.
