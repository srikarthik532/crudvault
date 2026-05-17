# CrudVault — Technical Specification

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Host machine                                               │
│                                                             │
│  Browser ──► localhost:3000                                 │
│                    │                                        │
│  ┌─────────────────▼─────────────────────────────────────┐ │
│  │  Docker network: crudvault_default                    │ │
│  │                                                       │ │
│  │  ┌──────────────┐    /api/*     ┌──────────────────┐  │ │
│  │  │  frontend    │ ──────────── ► │      api         │  │ │
│  │  │  nginx:alpine│               │  ASP.NET Core 9  │  │ │
│  │  │  port 80     │               │  port 8080       │  │ │
│  │  └──────────────┘               └────────┬─────────┘  │ │
│  │                                          │ EF Core     │ │
│  │                                          ▼             │ │
│  │                                 ┌──────────────────┐  │ │
│  │                                 │       db         │  │ │
│  │                                 │  SQL Server 2022 │  │ │
│  │                                 │  port 1433       │  │ │
│  │                                 └──────────────────┘  │ │
│  │                                          │             │ │
│  │                                 sqldata volume         │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

Host port mappings:
  localhost:3000  →  frontend:80
  localhost:5000  →  api:8080
  localhost:1433  →  db:1433
```

---

## Layer Responsibilities

### Frontend (`frontend/`)

- Renders the entire UI as a React 19 SPA
- Manages all UI state in `App.tsx` using `useState` (no global state library)
- Communicates with the API exclusively through `src/api.ts` using axios
- All API calls use a relative base path (`/api`), so the same build works in both dev (Vite proxy) and production (nginx proxy)
- Built by Vite into static assets (`dist/`), served by nginx at runtime

### API (`backend/`)

- Exposes five REST endpoints under `/api/items`
- Validates routing and model binding via ASP.NET Core conventions
- Persists data to SQL Server via EF Core 9
- Runs `db.Database.Migrate()` on startup — applies any pending migrations automatically
- Builds the SQL connection string at runtime from environment variables using `SqlConnectionStringBuilder`
- CORS policy `AllowFrontend` permits requests from `http://localhost:5173`, `http://localhost:3000`, and `http://frontend:80`

### Database (`db` service)

- SQL Server 2022 running in the official Microsoft container image
- Data persisted to named Docker volume `sqldata` at `/var/opt/mssql`
- Accepts connections on port 1433
- Single database: `CrudVaultDb`
- Single user: `sa` (system administrator)

---

## Data Model

### SQL Server Table: `Items`

| Column        | SQL Type        | Nullable | Constraints                |
|---------------|-----------------|----------|----------------------------|
| `Id`          | `int`           | no       | Primary key, IDENTITY(1,1) |
| `Title`       | `nvarchar(max)` | no       |                            |
| `Description` | `nvarchar(max)` | yes      |                            |
| `Status`      | `nvarchar(max)` | no       |                            |
| `CreatedAt`   | `datetime2`     | no       |                            |
| `UpdatedAt`   | `datetime2`     | yes      |                            |

No indexes beyond the primary key. No foreign keys. No check constraints on `Status` — valid values are enforced by the API at the model level only (the C# model defaults to `"Active"`, and the frontend only sends one of the three values via the select element).

### EF Core Configuration

`AppDbContext` uses the default EF Core conventions — no `OnModelCreating` override, no Fluent API configuration. All column types, nullability, and identity settings are inferred from the C# model by convention.

---

## API Contract

Base path: `/api/items`

All request and response bodies are JSON. No authentication is required.

---

### GET /api/items

Returns all items, ordered by `createdAt` descending.

**Request**

No body, no query parameters.

**Response: 200 OK**

```json
[
  {
    "id": 3,
    "title": "Example item",
    "description": "An optional description",
    "status": "Active",
    "createdAt": "2026-05-17T18:01:32.0000000",
    "updatedAt": null
  }
]
```

Returns an empty array `[]` when no items exist.

---

### GET /api/items/{id}

Returns a single item by its integer ID.

**Request**

No body.

**Response: 200 OK**

```json
{
  "id": 3,
  "title": "Example item",
  "description": "An optional description",
  "status": "Active",
  "createdAt": "2026-05-17T18:01:32.0000000",
  "updatedAt": null
}
```

**Response: 404 Not Found**

Empty body.

---

### POST /api/items

Creates a new item. `createdAt` is set by the API to UTC now; any value sent in the request body is overwritten.

**Request body**

```json
{
  "title": "New item",
  "description": "Optional",
  "status": "Active"
}
```

| Field         | Required | Notes                                 |
|---------------|----------|---------------------------------------|
| `title`       | yes      | Non-empty string                      |
| `description` | no       | Omit or send `null` / `""`           |
| `status`      | no       | Defaults to `"Active"` if omitted     |

**Response: 201 Created**

Returns the full created item including server-assigned `id` and `createdAt`. The `Location` header points to `/api/items/{id}`.

```json
{
  "id": 4,
  "title": "New item",
  "description": "Optional",
  "status": "Active",
  "createdAt": "2026-05-17T18:05:00.0000000",
  "updatedAt": null
}
```

---

### PUT /api/items/{id}

Updates `title`, `description`, and `status` of an existing item. `id` and `createdAt` are not modifiable. `updatedAt` is set by the API to UTC now.

**Request body**

```json
{
  "title": "Updated title",
  "description": "Updated description",
  "status": "Inactive"
}
```

**Response: 200 OK**

Returns the full updated item.

```json
{
  "id": 4,
  "title": "Updated title",
  "description": "Updated description",
  "status": "Inactive",
  "createdAt": "2026-05-17T18:05:00.0000000",
  "updatedAt": "2026-05-17T18:10:00.0000000"
}
```

**Response: 404 Not Found**

Empty body. Returned when no item with the given `id` exists.

---

### DELETE /api/items/{id}

Deletes an item permanently.

**Request**

No body.

**Response: 204 No Content**

Empty body. Indicates successful deletion.

**Response: 404 Not Found**

Empty body. Returned when no item with the given `id` exists.

---

## EF Core Migration Strategy

The single migration (`20260517180132_InitialCreate`) creates the `Items` table. The API calls `db.Database.Migrate()` inside a scoped service block at application startup, before `app.Run()`. This means:

- On first run, EF Core creates `CrudVaultDb` and applies the `InitialCreate` migration.
- On subsequent runs, `Migrate()` detects that all migrations have already been applied and does nothing.
- If a new migration is added in future, it will be applied automatically on the next startup.

This approach trades fine-grained migration control for zero operational steps. It is appropriate for a learning project. In production you would apply migrations as a separate step before deploying the application binary.

---

## CORS Policy

Defined in `Program.cs` as policy name `AllowFrontend`. Allowed origins:

- `http://localhost:5173` — Vite dev server
- `http://localhost:3000` — Docker frontend exposed on host
- `http://frontend:80` — within the Docker network

All headers and methods are allowed. The policy is applied globally via `app.UseCors("AllowFrontend")`.

---

## Credential Management

The SA credential for SQL Server is never written into any committed file. The flow is:

1. `db.env` (gitignored) — supplies `MSSQL_SA_PASSWORD` to the `db` container directly via `env_file`.
2. `.env` (gitignored) — supplies `DB_PASS` which Compose interpolates into the `api` container's environment.
3. `Program.cs` — reads `DB_PASS` from the environment and injects it into a `SqlConnectionStringBuilder` instance via the indexer. This prevents it from appearing as a plain text key-value pair in any log, config snapshot, or build artifact.

The `db.env.example` and `.env.example` files are committed and contain only placeholder values. They document which variables to create, not their actual values.

See `DOCKER.md` for a full explanation of why this pattern is necessary.

---

## Build Pipeline

### Backend

1. `dotnet restore` — downloads NuGet packages from `CrudVault.Api.csproj`
2. `dotnet publish -c Release -o /app/publish` — compiles in Release mode and emits to `/app/publish` inside the build stage
3. The publish output is copied into the `aspnet:9.0` runtime image
4. The runtime image contains no SDK, source code, or NuGet cache

Key packages (all version 9.0.5):
- `Microsoft.EntityFrameworkCore.SqlServer` — EF Core SQL Server provider
- `Microsoft.EntityFrameworkCore.Design` — design-time only, not in runtime output
- `Microsoft.EntityFrameworkCore.Tools` — design-time only, not in runtime output

### Frontend

1. `npm ci` — installs exact versions from `package-lock.json`
2. `npm run build` — Vite bundles and minifies to `dist/`
3. The `dist/` folder is copied to `/usr/share/nginx/html` in the nginx runtime image
4. The runtime image contains no Node.js, npm, or source files

---

## nginx Reverse Proxy

The frontend nginx configuration (`frontend/nginx.conf`) handles two route categories:

- Requests to `/api/*` are forwarded to the `api` container on port 8080. Path is preserved: a browser request to `/api/items` arrives at the API as `/api/items`.
- All other requests attempt to serve a static file, then fall back to `index.html`. This is the standard SPA serving pattern — it ensures that client-side routes return `index.html` rather than a 404.

The `Host` and `X-Real-IP` headers are forwarded to the API so that the upstream can see the original request host and client IP.

---

## Port Mappings

| Service    | Host port | Container port | Purpose                                           |
|------------|-----------|----------------|---------------------------------------------------|
| `frontend` | 3000      | 80             | React SPA served by nginx                         |
| `api`      | 5000      | 8080           | ASP.NET Core API (default Kestrel port in Docker) |
| `db`       | 1433      | 1433           | SQL Server; host exposure is for tooling only     |

The host port for `db` (1433) is exposed so that tools like Azure Data Studio or SSMS can connect from the host machine. The frontend and API containers communicate with `db` over the internal Docker network, not through the host port mapping.
