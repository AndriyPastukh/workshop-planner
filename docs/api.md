# REST API Reference — Workshop Planner

Усі захищені маршрути вимагають заголовок:
`Authorization: Bearer <JWT>`

Ролі:
- `owner` — повний доступ (включно з налаштуваннями, правилами setup, видаленням, верстатами, матеріалами);
- `operator` — перегляд усіх довідників, робота із замовленнями, коригування залишків складу, запуск планувальника й перевірка здійсненності.

Уніфікований формат помилки:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Опис помилки українською",
    "details": []
  }
}
```

## Стан-машина статусів замовлення (`orders`)
`draft` → `quoted` | `confirmed` | `cancelled`  
`quoted` → `confirmed` | `draft` | `cancelled`  
`confirmed` → `in_progress` | `cancelled`  
`in_progress` → `done` | `cancelled`  
`done`, `cancelled` — термінальні стани.  
Перехід у `confirmed` атомарно резервує матеріали (`reservedQty`); `in_progress` знімає резерв і списує матеріали зі складу (`consume`) із неблокуючими `warnings` (`LOW_STOCK` / `INSUFFICIENT_STOCK`); `cancelled` знімає резерв (`release`) і видаляє записи розкладу замовлення; `done` фіксує фактичну витрату (`actualUsages`) та записує відхилення у рухи `waste`.

## Ендпоінти

| Група | Метод і шлях | Доступ | Призначення |
|---|---|---|---|
| Health | `GET /api/health` | публічний | Стан API-сервісу (`status: "ok"`) |
| Auth | `POST /api/auth/login` | публічний (rate-limit 20/15 хв) | Вхід за `email` + `password`, повертає JWT і `user` |
| Auth | `GET /api/auth/me` | auth | Поточний профіль користувача |
| Machines | `GET /api/machines`, `GET /api/machines/:id` | auth | Список верстатів, календар змін, вікна ТО |
| Machines | `POST /api/machines`, `PATCH /api/machines/:id`, `DELETE /api/machines/:id` | `owner` | Керування обладнанням |
| Machines | `POST /api/machines/:id/maintenance`, `DELETE /api/machines/:id/maintenance/:windowId` | `owner` | Додавання/видалення вікна ТО |
| Materials | `GET /api/materials`, `GET /api/materials/:id` | auth | Склад (`stockQty`, `reservedQty`, `inWorkQty`, `availableQty`, `status`), прогноз дефіциту `shortages` та історія руху |
| Materials | `POST /api/materials/:id/receipt` | auth | Оприбуткування матеріалу на склад (`qty > 0`, `comment`) |
| Materials | `POST /api/materials/:id/adjust` | `owner` | Ручне коригування залишку (`deltaQty`, `comment`) із захистом від `< 0` |
| Materials | `POST /api/materials/:id/adjust-stock` | auth/`owner` | Сумісний ендпоінт поповнення або owner-коригування |
| Materials | `POST/PATCH/DELETE /api/materials...` | `owner` | Керування довідником матеріалів |
| Customers | `GET /api/customers`, `GET /api/customers/:id` | auth | Клієнти, історія замовлень, загальна сума та середній чек |
| Customers | `POST /api/customers`, `PATCH /api/customers/:id` | auth | Створення й оновлення клієнта |
| Customers | `DELETE /api/customers/:id` | `owner` | Видалення клієнта без замовлень |
| Templates | `GET /api/templates` | auth | Шаблони типових виробів |
| Templates | `POST/PATCH/DELETE /api/templates...` | `owner` | Керування шаблонами виробів |
| Settings | `GET /api/settings` | auth | Ставки, маржа, податки, `atcsK1`, `atcsK2`, пороги знижок |
| Settings | `PATCH /api/settings` | `owner` | Оновлення глобальних параметрів майстерні |
| Setup Rules | `GET /api/setup-rules` | auth | Матриця переходів між матеріалами |
| Setup Rules | `PUT /api/setup-rules`, `DELETE /api/setup-rules/:id` | `owner` | Додавання/оновлення одного правила або масиву правил |
| Pricing | `POST /api/pricing/preview` | auth | Повна деталізація собівартості й ціни (без запису в БД, без похибки округлення) |
| Orders | `GET /api/orders`, `GET /api/orders/:id` | auth | Список замовлень і повні деталі (`pricingSummary`, `materialSummary`, `materialTotals`, `auditLogs`, `stockMovements`) |
| Orders | `POST /api/orders`, `PATCH /api/orders/:id` | auth | Створення замовлення та редагування (`items` у `draft`/`quoted`) із перерахунком розбивки |
| Orders | `PATCH /api/orders/:id/status` | auth | Валідований перехід статусу + автосписання матеріалів |
| Orders | `DELETE /api/orders/:id` | `owner` | Видалення замовлення у статусі `draft` або `cancelled` |
| Planner | `GET /api/schedule` | auth | Поточний план робіт, верстати й агреговані метрики |
| Planner | `POST /api/schedule/rebuild` | auth | Перепланування (`FIFO` / `EDD` / `SPT` / `ATCS`, опція `enableBatchSplit`) зі збереженням `locked` та обходом вікон ТО |
| Planner | `PATCH /api/schedule/:id` | auth | Переміщення слоту/верстата (`409 SCHEDULE_CONFLICT` або `MAINTENANCE_CONFLICT`) або перемикання `locked` |
| Planner | `GET /api/schedule/compare` | auth | Порівняння метрик `FIFO`, `EDD`, `SPT`, `ATCS` на поточній черзі |
| Planner | `POST /api/schedule/what-if` | auth | Сценарне моделювання «Що якщо?» (+віртуальні верстати, правило, $k_1/k_2$, `enableBatchSplit`, тарифи) без запису в БД |
| Feasibility | `POST /api/quotes/feasibility` | auth | Перевірка «чи встигну?» для нового замовлення (без запису в БД) |
| Analytics | `GET /api/analytics/dashboard` | auth | KPI для дашборда, дефіцитні матеріали, найближчі дедлайни |
| Analytics | `GET /api/analytics/summary` | auth | Виручка, собівартість, прибуток по типах верстатів і клієнтах |
