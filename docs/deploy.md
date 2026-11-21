# Розгортання на Render (Deployment Guide)

У production-режимі (`NODE_ENV=production`) Express-сервер одночасно обслуговує REST API (`/api/*`) та роздає зібраний статичний фронтенд (`client/dist`) з єдиного домену, що усуває потребу налаштовувати міждоменний CORS чи окремий статичний хостинг.

---

## Варіант А — Автоматичний деплой через Blueprint (`render.yaml`)

1. Запуште актуальний код у публічний або підключений GitHub-репозиторій (гілка `main`).
2. У панелі [Render Dashboard](https://dashboard.render.com/) виберіть **New + → Blueprint**.
3. Оберіть репозиторій `workshop-planner` — Render автоматично зчитає [render.yaml](../render.yaml) і створить:
   - базу даних PostgreSQL `workshop-planner-db` (`plan: free`);
   - Web Service `workshop-planner` із командою збірки:
     ```bash
     npm ci && npm run db:generate && npm run build
     ```
     та командою старту:
     ```bash
     npm run start:prod
     ```
4. Натисніть **Apply** — через кілька хвилин сервіс стане доступним за публічним URL `https://<service>.onrender.com`.

> При першому старті `npm run start:prod` виконує `prisma migrate deploy`, потім безпечний `scripts/seed-prod.js` (заповнює демо-дані **лише якщо таблиця `users` порожня**), і запускає Express. Наступні рестарти ніколи не перезаписують бойові замовлення.

---

## Варіант Б — Render Web Service + зовнішня БД Neon Postgres

Якщо база розгорнута окремо на [Neon](https://neon.tech/):
1. Створіть проєкт у Neon та скопіюйте connection string у форматі PostgreSQL (з `?sslmode=require`).
2. У Render виберіть **New + → Web Service**, підключіть репозиторій:
   - **Runtime:** `Node`
   - **Build Command:** `npm ci && npm run db:generate && npm run build`
   - **Start Command:** `npm run start:prod`
   - **Health Check Path:** `/api/health`
3. У розділі **Environment Variables** додайте:

| Змінна | Значення | Призначення |
|---|---|---|
| `NODE_ENV` | `production` | Вмикає роздачу `client/dist` і production CSP |
| `DATABASE_URL` | `postgresql://...?sslmode=require` | Рядок підключення до PostgreSQL |
| `JWT_SECRET` | Випадковий 64+ символьний рядок | Підпис JWT-токенів авторизації |
| `PORT` | `3001` (або системний від Render) | HTTP-порт Express |

---

## Чекліст перевірки після деплою

1. Відкрийте `https://<ваш-домен>/api/health` — очікується `200 OK` і `{ "status": "ok" }`.
2. Відкрийте `https://<ваш-домен>/login` — увійдіть під `owner@workshop.ua` / `Owner123!` (або одразу змініть пароль у продакшні).
3. Перевірте в DevTools браузера відсутність помилок консолі та CSP-блокувань (`script-src 'self'`, завантаження `/theme-init.js`).
4. Створіть тестове замовлення з live-деталізацією ціни та запустіть перепланування `ATCS` на сторінці `/planner`.
