# Good Faith Estimator

JavaScript monorepo using npm workspaces. The React frontend uses Vite and Tailwind CSS. The Fastify API connects to PostgreSQL through Drizzle ORM and `pg`.

| Path | Purpose |
| --- | --- |
| `apps/web` | React frontend |
| `apps/api` | Fastify API and Drizzle configuration |
| `apps/api/src/db/schema.js` | PostgreSQL table definitions |

## Run locally

Install Node.js 22.12 or later and have a PostgreSQL database available.

```sh
git clone https://github.com/waduncan/good-faith-estimator.git
cd good-faith-estimator
npm ci
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell or `cp .env.example .env` in Bash). Set `DATABASE_URL` to your PostgreSQL connection string. If you already have Docker and need a local database, this command creates one matching the example settings.

```sh
docker run --name gfe-postgres -e POSTGRES_USER=gfe -e POSTGRES_PASSWORD=gfe_dev -e POSTGRES_DB=gfe -p 127.0.0.1:5432:5432 -v gfe-postgres-data:/var/lib/postgresql/data -d postgres:17
```

```sh
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` requests to Fastify on port 3000 by default. The starter page checks the API and database connection.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health` | Returns HTTP 200 when the API is running |
| `GET /api/ready` | Runs `select 1` through Drizzle. Returns HTTP 200 on success or 503 when PostgreSQL is unavailable |

## Database migrations

The starter has no application tables. After adding or changing table definitions in `apps/api/src/db/schema.js`, generate and review the migration before applying it.

```sh
npm run db:generate
npm run db:migrate
```

Commit generated files in `apps/api/drizzle/` along with schema changes.

## Build and run

```sh
npm run build
npm start
```

Fastify serves the built frontend and API from [http://127.0.0.1:3000](http://127.0.0.1:3000). Set `HOST` and `PORT` to change the Fastify listener.
