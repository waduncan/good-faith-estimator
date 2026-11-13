# Good Faith Estimator

Internal application for preparing PDF Good Faith Estimates for uninsured or self-pay patients. The React frontend uses Vite and Tailwind CSS. The Fastify API connects to PostgreSQL through Drizzle ORM and `pg`.

| Path | Purpose |
| --- | --- |
| `apps/web` | React frontend |
| `apps/api` | Fastify API and Drizzle configuration |
| `apps/api/src/db/schema.js` | Versioned CDM, location, appointment type, and bundle tables |
| `apps/api/src/routes` | Scheduler and protected administration APIs |
| `apps/api/src/services` | CDM normalization, admin sessions, and in-memory PDF generation |

## Run locally

Install Node.js 22.12 or later and have a PostgreSQL database available.

```sh
git clone https://github.com/waduncan/good-faith-estimator.git
cd good-faith-estimator
npm ci
```

Create a `.env` file and set at least these values:

```dotenv
DATABASE_URL=postgresql://gfe:gfe_dev@127.0.0.1:5432/gfe
ADMIN_SECRET=replace-with-a-long-random-secret
HOST=127.0.0.1
PORT=3000
```

`ADMIN_SECRET` protects organization, location, CDM, and appointment-bundle configuration. Production must use a strong secret supplied through the deployment secret manager. If you already have Docker and need a local database, this command creates one matching the database URL above.

```sh
docker run --name gfe-postgres -e POSTGRES_USER=gfe -e POSTGRES_PASSWORD=gfe_dev -e POSTGRES_DB=gfe -p 127.0.0.1:5432:5432 -v gfe-postgres-data:/var/lib/postgresql/data -d postgres:17
```

Apply the database migration, then start both applications:

```sh
npm run db:migrate
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` requests to Fastify on port 3000. Use the **Administration** link to complete initial setup in this order:

1. Configure the legal organization identity.
2. Add each service location.
3. Validate and publish one CDM CSV per location.
4. Add the shared appointment-type catalog.
5. Select each location and configure its standard CPT bundle for every supported appointment type.

The same appointment type can—and often will—have a different ordered CPT bundle at each location.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health` | Returns HTTP 200 when the API is running |
| `GET /api/ready` | Runs `select 1` through Drizzle. Returns HTTP 200 on success or 503 when PostgreSQL is unavailable |
| `GET /api/locations/:id/services?q=` | Searches only the selected location's active CPT charges |
| `GET /api/locations/:id/appointment-types/:id/bundle` | Resolves the location-specific standard bundle |
| `POST /api/estimates/pdf` | Revalidates active CDM charges and returns a non-persisted PDF |

## CDM import contract

Imports require `description`, `standard_charge|gross`, and at least one paired `code|n` / `code|n|type` column. The importer:

- extracts only codes whose type is `CPT`;
- includes `outpatient` and `both` settings;
- uses the gross standard charge;
- collapses identical rows repeated for payer/plan combinations; and
- rejects conflicting descriptions or gross charges for the same CPT, modifiers, and setting.

Every valid import is retained as a version. Publishing or rolling back changes the active version atomically. Imports report appointment bundles that reference CPTs unavailable in the candidate version.

For CSVs over the 25 MB browser upload limit, run the importer from the project root in PowerShell. Use the location’s short code from Administration. The first command previews the import. The second publishes it to the database configured by `DATABASE_URL`.

```powershell
npm run cdm:import -- --location HHM --file "C:\path\Huntsville-Hospital.csv"
npm run cdm:import -- --location HHM --file "C:\path\Huntsville-Hospital.csv" --publish
```

Run the command once per location. It streams the source CSV from disk, keeps only the normalized CPT charges in memory, and leaves the source file intact. Published versions appear in the app’s import history and can be rolled back there.

## Database migrations

After changing table definitions in `apps/api/src/db/schema.js`, generate and review the migration before applying it.

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

Production should terminate TLS at the internal reverse proxy, restrict scheduler access to the trusted network, back up PostgreSQL, and set `NODE_ENV=production` so administrator cookies require HTTPS.

## Verification and compliance

```sh
npm test
npm run build
```

Patient information and generated PDFs are held only for the generation request and are not stored by the application. Request bodies are not logged. The generated document includes current federal GFE content and dispute language, but the final template and deployment must be reviewed by the organization's compliance, privacy, accessibility, and security teams before production use.
