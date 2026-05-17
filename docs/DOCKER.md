# CrudVault — Docker Guide

This document explains every Docker decision in this project: what each line does, why it exists, and what happens if you change or remove it. It assumes you are comfortable with C# and React but are new to containerising applications.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Backend Dockerfile — Line by Line](#backend-dockerfile--line-by-line)
3. [Frontend Dockerfile — Line by Line](#frontend-dockerfile--line-by-line)
4. [docker-compose.yml — Section by Section](#docker-composeyml--section-by-section)
5. [Networking](#networking)
6. [Credential Management](#credential-management)
7. [Common Commands](#common-commands)
8. [Rebuild vs Restart](#rebuild-vs-restart)
9. [Troubleshooting](#troubleshooting)

---

## Core Concepts

### What is a Docker image?

A Docker image is a read-only blueprint for a container. Think of it like a class definition — it describes what the container will contain and how it will start, but it is not itself running anything.

Images are built in layers. Each instruction in a Dockerfile (`FROM`, `COPY`, `RUN`) produces a new layer stacked on top of the previous one. Layers are cached and reused. If layer N has not changed since the last build, Docker skips rebuilding it and serves it from cache. This is why the order of instructions in a Dockerfile matters — put things that change least frequently at the top.

```
Layer 0: FROM aspnet:9.0         ← base OS + ASP.NET runtime
Layer 1: WORKDIR /app            ← creates the working directory
Layer 2: COPY --from=build . .   ← your published application
Layer 3: EXPOSE 8080             ← metadata only
```

Each layer only stores the diff from the layer below it. The total image size is the sum of all layers.

### What is a Docker container?

A container is a running instance of an image — like an object instantiated from a class. It is an isolated process on the host machine with its own filesystem (based on the image), its own network interface, and its own process namespace. It cannot see or affect other containers or the host unless explicitly configured to do so.

When a container exits, any changes it made to its filesystem are discarded unless the data was written to a volume.

### What is a Docker volume?

A volume is persistent storage managed by Docker that lives outside the container's filesystem. Data written to a volume survives container stops and removals.

In this project, the `sqldata` volume stores SQL Server's data files at `/var/opt/mssql` inside the `db` container. Running `docker compose down` does not delete the volume — your data is preserved. Only `docker compose down -v` removes the volume and all database data.

Named volumes (like `sqldata`) are managed by Docker. Bind mounts (not used here) map a specific host directory into a container. Named volumes are preferred for database data because Docker controls their location and lifecycle independently of the host filesystem layout.

### What is a Docker network?

When Docker Compose starts your services, it creates a private network and attaches all containers to it. On this network, containers reach each other using the service name as a hostname.

In this project, the `api` container reaches the `db` container at hostname `db`. The `frontend` nginx reaches the `api` container at hostname `api`. No IP addresses are needed. Container-to-container traffic stays entirely within the Docker network and never touches the host machine's ports.

### Multi-stage builds

A multi-stage build uses multiple `FROM` instructions in a single Dockerfile. Each `FROM` starts a new build stage, and you can selectively copy files from one stage into another.

The reason this exists: build tools are large and must not end up in your production image.

| Image | Approximate size |
|---|---|
| `mcr.microsoft.com/dotnet/sdk:9.0` | ~800 MB |
| `mcr.microsoft.com/dotnet/aspnet:9.0` | ~220 MB |
| `node:22-alpine` | ~180 MB |
| `nginx:alpine` | ~25 MB |

Without multi-stage builds you would either ship an ~800 MB image with the compiler included (wasteful and a larger attack surface), or run the build outside Docker and copy artifacts in manually (fragile, environment-dependent).

With multi-stage builds:

```
Stage 1: Use the large build image. Compile everything. Produce artifacts.
Stage 2: Start fresh from a small runtime image. Copy only the artifacts.
```

The final shipped image only contains what Stage 2 accumulated. Stage 1 is discarded at the end of the build.

### Docker layer caching

Docker caches the result of each layer. When you rebuild an image, Docker walks down the Dockerfile and stops using the cache at the first layer whose input has changed. All subsequent layers rebuild from scratch.

This is why both Dockerfiles copy dependency manifests before copying source code:

```dockerfile
COPY *.csproj .          # layer A — changes rarely
RUN dotnet restore       # layer B — cached unless A changed
COPY . .                 # layer C — changes on every code edit
RUN dotnet publish ...   # layer D — rebuilds whenever C changes
```

If you did `COPY . .` first and then ran `dotnet restore`, every code change would invalidate the restore cache and force a full package download. By splitting it, a code change only invalidates layers C and D. The restore step (slow on first run) is cached across code edits.

### `env_file` vs `environment` in Compose

Both inject values into a container's environment, but they work differently.

**`env_file`** reads a file from the host and injects every `KEY=value` line into the container as-is — no substitution or interpolation. Used for the `db` service because SQL Server reads `MSSQL_SA_PASSWORD` directly from its environment, and we want that value to come from a gitignored file that never touches `docker-compose.yml`.

**`environment`** lists key-value pairs directly in `docker-compose.yml`. Values can use `${VARIABLE}` syntax, which Compose resolves from a `.env` file on the host (or the current shell environment). Used for the `api` service: non-sensitive constants like `DB_HOST=db` and `DB_NAME=CrudVaultDb` are written inline; the sensitive value is referenced as `DB_PASS: ${DB_PASS}` and resolved at runtime from `.env`.

Rule of thumb: use `env_file` when the entire file is secret. Use `environment` with `${VAR}` interpolation when only specific values are secret.

### `depends_on` with health checks

`depends_on` tells Compose the startup order between services. By default it only waits for the container to start, not for the process inside it to be ready.

SQL Server takes 20–30 seconds to initialise after its container starts. If the API starts and tries to connect before SQL Server is accepting connections, the API crashes immediately.

The solution is a health check on the `db` service combined with `condition: service_healthy` in the `api` dependency:

```yaml
# on db:
healthcheck:
  test: ["CMD-SHELL", "sqlcmd -S localhost -U sa -P $$MSSQL_SA_PASSWORD -Q 'SELECT 1' -No"]
  interval: 10s
  retries: 10
  start_period: 30s

# on api:
depends_on:
  db:
    condition: service_healthy
```

The probe runs every 10 seconds. The `start_period: 30s` tells Docker not to count failures during the first 30 seconds of container life — giving SQL Server its initialisation window without being marked unhealthy. After 10 consecutive failures past the start period, the container is marked unhealthy and dependent services will not start.

Without `condition: service_healthy`, `api` would start immediately upon `db` container creation and crash trying to run EF Core migrations against a SQL Server that is not yet listening.

---

## Backend Dockerfile — Line by Line

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
```

Starts Stage 1. Uses the official .NET 9 SDK image from Microsoft's container registry (`mcr.microsoft.com`). The `AS build` label names this stage so later instructions can reference it with `--from=build`. This image includes the full SDK: C# compiler, NuGet client, MSBuild, and all build tools. It is large (~800 MB) and will not appear in the final shipped image.

```dockerfile
WORKDIR /src
```

Creates the directory `/src` inside the container and sets it as the working directory for all subsequent instructions. Equivalent to `mkdir -p /src && cd /src`. All relative paths in `COPY` and `RUN` instructions below are relative to this directory.

```dockerfile
COPY *.csproj .
```

Copies only the `.csproj` file from your local `backend/` directory into `/src/`. This is the layer-caching optimisation — by copying just the project manifest first, the `dotnet restore` step below can be cached independently of any source code changes. The trailing `.` means "into the current working directory" (`/src`).

```dockerfile
RUN dotnet restore
```

Downloads all NuGet packages declared in the `.csproj`. Because the previous layer only copied the `.csproj` and not any source files, this layer is cached as long as the `.csproj` is unchanged. If you edit `Program.cs` but not the `.csproj`, this layer is served from cache — no network download, no waiting.

```dockerfile
COPY . .
```

Copies all remaining files from `backend/` into `/src/` — `Controllers/`, `Models/`, `Data/`, `Migrations/`, `Program.cs`, `appsettings.json`, etc. This layer is invalidated on every code change, but that is fine because the expensive `dotnet restore` layer above it remains cached.

```dockerfile
RUN dotnet publish -c Release -o /app/publish
```

Compiles the application in Release configuration and writes output to `/app/publish` inside the build stage. `dotnet publish` compiles the code, resolves all dependencies, and produces a complete deployable set of files: DLLs, the runtime configuration file (`CrudVault.Api.runtimeconfig.json`), and all dependency assemblies. The `-c Release` flag enables compiler optimisations and disables debug symbols. If you remove `-c Release`, you get a Debug build — larger, slower, with debug symbols included.

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
```

Starts Stage 2 with a completely fresh base image. `aspnet:9.0` contains only the ASP.NET Core runtime — not the SDK, not the compiler, not NuGet. It is roughly a quarter the size of the SDK image. Nothing from Stage 1 carries over automatically — only what you explicitly copy with `COPY --from=`.

```dockerfile
WORKDIR /app
```

Sets the working directory in the runtime image. All paths below are relative to `/app`.

```dockerfile
COPY --from=build /app/publish .
```

The critical multi-stage instruction. Copies the publish output from the `build` stage's `/app/publish` into the runtime stage's current directory (`/app`). This is the only thing that crosses the stage boundary. Source code, NuGet cache, the SDK, and intermediate build objects are all left behind in Stage 1 and discarded when the build completes.

```dockerfile
EXPOSE 8080
```

Documents that the container listens on port 8080. This is metadata only — it does not publish the port or make it reachable from outside Docker. The actual port binding happens in `docker-compose.yml` under `ports:`. ASP.NET Core 9 listens on port 8080 by default inside containers because the Microsoft base images set the environment variable `ASPNETCORE_HTTP_PORTS=8080`.

```dockerfile
ENTRYPOINT ["dotnet", "CrudVault.Api.dll"]
```

The command that runs when the container starts. The JSON array form (exec form) runs the process directly rather than through a shell. This matters for signal handling: when Docker sends `SIGTERM` to stop the container gracefully, the signal reaches `dotnet` directly rather than being absorbed by a shell process. `CrudVault.Api.dll` is the entry point assembly produced by `dotnet publish`.

---

## Frontend Dockerfile — Line by Line

```dockerfile
FROM node:22-alpine AS build
```

Starts Stage 1 using Node.js 22 on Alpine Linux. `alpine` is a minimal Linux distribution (~5 MB base) that excludes most of the tools present in standard Debian or Ubuntu images. This reduces the build stage image from ~900 MB (full Node.js Debian image) to ~180 MB. The `AS build` label names this stage.

```dockerfile
WORKDIR /app
```

Creates and sets `/app` as the working directory for all subsequent instructions.

```dockerfile
COPY package*.json .
```

Copies `package.json` and `package-lock.json` (the glob `package*.json` matches both). Same layer-caching rationale as the backend: copy dependency manifests first so the install step can be cached separately from application source code changes.

```dockerfile
RUN npm ci
```

Installs dependencies from `package-lock.json` exactly. `npm ci` is the correct choice for Docker and CI environments for three reasons:

1. It installs the exact versions recorded in `package-lock.json`. No version resolution, no surprises, fully reproducible.
2. It deletes `node_modules` before installing, ensuring a clean state every time.
3. It fails fast if `package.json` and `package-lock.json` are out of sync — which catches a class of bugs before they reach production.

`npm install`, by contrast, may update `package-lock.json` and silently install different versions. In a reproducible build environment that is not acceptable.

```dockerfile
COPY . .
```

Copies all remaining frontend source files into `/app/`: `src/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `nginx.conf`, and everything else. Invalidated on any source change, but the `npm ci` layer above remains cached as long as `package-lock.json` has not changed.

```dockerfile
RUN npm run build
```

Runs `vite build`, which compiles TypeScript, processes Tailwind CSS, bundles all modules with tree-shaking, and writes the output to `/app/dist/`. The output is static HTML, CSS, and JavaScript — no server-side runtime is required to serve it.

```dockerfile
FROM nginx:alpine AS runtime
```

Starts Stage 2 from the official nginx image on Alpine. This image is approximately 25 MB. It contains only nginx — no Node.js, no npm, no source files.

Why nginx instead of `npm run preview`? Vite's preview server is a development convenience tool. It is not hardened for production, does not serve correct cache headers, and requires Node.js in the runtime image. nginx is a production-grade static file server that handles the SPA routing fallback (`try_files`), reverse proxying to the API, and static asset serving — all natively, with no runtime scripting language.

```dockerfile
COPY --from=build /app/dist /usr/share/nginx/html
```

Copies the Vite build output from Stage 1 into nginx's default web root. nginx serves files from `/usr/share/nginx/html` by default. Everything else from the build stage — Node.js, npm, `node_modules`, source files — is discarded.

```dockerfile
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

Replaces nginx's default site configuration with the project's custom `nginx.conf`. The path `/etc/nginx/conf.d/default.conf` is the standard virtual host config location in the nginx:alpine image. The custom config adds the SPA fallback and the `/api/` reverse proxy. If you omit this line, nginx serves files but client-side routes return 404 and API requests are not proxied.

```dockerfile
EXPOSE 80
```

Documents that nginx listens on port 80. Same metadata-only note as the backend — actual port binding is in `docker-compose.yml`.

---

## docker-compose.yml — Section by Section

### Top-level `services:`

```yaml
services:
  db:
  api:
  frontend:
```

Declares the three containers. Each key becomes both the service name and the DNS hostname on the Docker network. Choosing `db`, `api`, and `frontend` as names directly determines how the containers reference each other: `DB_HOST=db`, `proxy_pass http://api:8080`.

---

### `db` service

```yaml
db:
  image: mcr.microsoft.com/mssql/server:2022-latest
```

`image:` tells Compose to pull and run a pre-built image rather than building from a local Dockerfile. Microsoft ships the SQL Server container image directly — there is no application code to compile, so no local Dockerfile is needed.

```yaml
  env_file:
    - ./db.env
```

Reads every `KEY=value` line from `db.env` and injects them into the container's environment verbatim. The SQL Server image reads two variables on startup: `ACCEPT_EULA` (must be `Y` — agreement to the SQL Server EULA) and `MSSQL_SA_PASSWORD` (the SA account credential, must meet SQL Server complexity requirements). Using `env_file` means neither value appears in `docker-compose.yml`.

```yaml
  ports:
    - "1433:1433"
```

Port mapping format is always `HOST:CONTAINER`. This maps host machine port 1433 to the container's port 1433, allowing database tools on the host (Azure Data Studio, SSMS) to connect at `localhost,1433`. The `api` container does not use this mapping — it reaches `db` directly over the Docker network using the service name.

```yaml
  volumes:
    - sqldata:/var/opt/mssql
```

Mounts the named volume `sqldata` at `/var/opt/mssql` inside the container. SQL Server writes all database files to that path. Without this, all data is lost every time the container is removed. With it, `docker compose down` followed by `docker compose up` restores the exact same database state.

```yaml
  healthcheck:
    test: ["CMD-SHELL", "/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P $$MSSQL_SA_PASSWORD -Q 'SELECT 1' -No"]
    interval: 10s
    retries: 10
    start_period: 30s
```

The probe Docker runs to determine container health. `CMD-SHELL` runs through a shell so that `$$MSSQL_SA_PASSWORD` expands to the container's `MSSQL_SA_PASSWORD` environment variable at runtime (the double `$$` is Compose's escape for a literal `$` in the shell). The probe executes `SELECT 1` via `sqlcmd` — if SQL Server is up and accepting connections, this exits 0 (healthy). Parameters: run every 10 seconds, allow 30 seconds before counting failures, require 10 consecutive failures before marking unhealthy.

---

### `api` service

```yaml
api:
  build: ./backend
```

`build:` tells Compose to build an image from the Dockerfile found at `./backend/`. This is the distinction from `db` which uses `image:`. When you run `docker compose up --build`, Compose executes the backend Dockerfile and produces the `crudvault-api` image.

```yaml
  ports:
    - "5000:8080"
```

Maps host port 5000 to container port 8080 (where Kestrel listens). This lets you call the API directly from the host at `http://localhost:5000/api/items` — useful for testing with curl or Postman without going through the frontend container.

```yaml
  environment:
    DB_HOST: db
    DB_NAME: CrudVaultDb
    DB_USER: sa
    DB_PASS: ${DB_PASS}
    ASPNETCORE_ENVIRONMENT: Production
```

Sets environment variables in the container. Non-sensitive constants are written inline. `DB_PASS: ${DB_PASS}` uses Compose variable interpolation — Compose reads the `DB_PASS` value from the `.env` file on the host and substitutes it. The `api` container receives `DB_PASS` as a plain environment variable; it never sees the `.env` file.

`ASPNETCORE_ENVIRONMENT: Production` tells ASP.NET Core to use production configuration — no developer exception pages, production logging levels.

`DB_HOST: db` works because `db` is a Docker Compose service name. Docker's internal DNS resolves `db` to the IP address of the SQL Server container on the shared network.

```yaml
  depends_on:
    db:
      condition: service_healthy
```

Holds the `api` container in a waiting state until `db` reports healthy via its health check. Without this, `api` starts immediately, hits `db.Database.Migrate()` in `Program.cs`, finds SQL Server not yet listening, and crashes. With it, the ordering is guaranteed: EF Core migrations run only after SQL Server is verified ready.

---

### `frontend` service

```yaml
frontend:
  build: ./frontend
  ports:
    - "3000:80"
  depends_on:
    - api
```

Builds from `./frontend/Dockerfile` and maps host port 3000 to container port 80 (nginx). `depends_on: - api` uses the simple form — Compose waits for the `api` container to start, not for it to pass any health check. This is acceptable because the frontend is a static file server. It makes no API calls on startup; it only proxies requests triggered by user interaction in the browser, by which time the API is ready.

---

### Root `volumes:` section

```yaml
volumes:
  sqldata:
```

Declares the named volume `sqldata` at the project level. Without this declaration, the volume reference under `db: volumes:` would fail with a validation error. The empty value means Docker manages the volume with default settings — no custom driver, no options. Docker creates it on first `docker compose up` and reuses it on every subsequent run.

---

## Networking

### How containers find each other

When Compose starts, it creates a Docker bridge network named `crudvault_default` (the prefix comes from the project name, which defaults to the directory name). Every service is automatically connected to this network.

Docker provides internal DNS on this network. Each service name resolves to the IP address of its container. This is why:

- `DB_HOST=db` works in the API — `Program.cs` sets `DataSource = "db,1433"` and Docker resolves `db` to the SQL Server container's internal IP.
- `proxy_pass http://api:8080` works in nginx — Docker resolves `api` to the ASP.NET Core container's internal IP.

This DNS resolution is only available inside the Docker network. From the host machine, `db` and `api` are not resolvable — you use `localhost` with the mapped host ports (1433, 5000, 3000).

### Why `localhost` does not work between containers

Every container has its own loopback interface. `localhost` inside the `api` container means the `api` container itself — not the host machine, not the `db` container. If `DB_HOST` were set to `localhost`, the API would try to connect to a SQL Server instance running inside its own container, which does not exist, and fail immediately.

Container-to-container communication must always use the service name as the hostname.

### Request flow in Docker (production mode)

```
Browser  →  http://localhost:3000/api/items
                │
                ▼
        frontend container (nginx, port 80)
        path starts with /api/ → proxy_pass http://api:8080/api/items
                │
                ▼
        api container (Kestrel, port 8080)
        ItemsController.GetAll()
        EF Core: SELECT * FROM Items ORDER BY CreatedAt DESC
                │
                ▼
        db container (SQL Server, port 1433)
                │
        ◄───────┘  response travels back up the chain
                │
        Browser receives JSON array
```

### Request flow in local development (no Docker)

```
Browser  →  http://localhost:5173/api/items
                │
                ▼
        Vite dev server (port 5173)
        proxy: /api → http://localhost:5000
                │
                ▼
        ASP.NET Core running locally (port 5000)
                │
                ▼
        SQL Server running locally (port 1433)
```

`src/api.ts` is identical in both environments — it always uses the relative path `/api/items`. The proxy layer (Vite in dev, nginx in Docker) routes it to the correct upstream. You never hardcode a host or port in the API client code.

---

## Credential Management

### Why secrets cannot go in Dockerfiles

Dockerfiles are committed to source control. Any value written in a Dockerfile is baked into an image layer and is visible to anyone who runs `docker history <image>`. Even if you later remove the line, the history remains in the git log. The SA credential must never appear in any Dockerfile.

### Why secrets cannot go inline in `docker-compose.yml`

`docker-compose.yml` is also committed to source control. A credential written there is in git history permanently.

### The `env_file` pattern

`db.env` is gitignored. It never enters source control. The developer creates it manually from `db.env.example` before the first `docker compose up`. At runtime, Compose reads it and passes its contents into the `db` container's environment. SQL Server reads `MSSQL_SA_PASSWORD` from that environment and sets the SA credential.

`.env` is also gitignored. It holds `DB_PASS`, which Compose reads and substitutes into the `api` service's `DB_PASS: ${DB_PASS}` environment entry. The `api` container receives `DB_PASS` as a plain environment variable.

The two example files (`db.env.example`, `.env.example`) are committed. They document which variables to create and the expected format, but contain only placeholder values — they are safe to commit.

### The `SqlConnectionStringBuilder` indexer

In `Program.cs`, the credential is injected into the connection string via the builder's indexer:

```csharp
csb["Password"] = Environment.GetEnvironmentVariable("DB_PASS") ?? "";
```

This is functionally equivalent to setting `csb.Password`, but the indexer form avoids writing credentials as a plain key=value connection string literal in source — a pattern that secret-scanning tools and pre-commit hooks commonly flag. The value is only ever combined with the rest of the connection string in memory, at runtime.

### Summary: what is and is not committed

| File              | Contains                  | Committed |
|-------------------|---------------------------|-----------|
| `db.env`          | SA credential             | No        |
| `.env`            | API credential var        | No        |
| `db.env.example`  | Placeholder format        | Yes       |
| `.env.example`    | Placeholder format        | Yes       |
| `docker-compose.yml` | `${DB_PASS}` reference | Yes       |
| `Program.cs`      | Env var reads only        | Yes       |
| `Dockerfile`s     | No credentials            | Yes       |

---

## Common Commands

### `docker compose up --build`

Rebuilds images for all services that have a `build:` directive, then starts all containers. Use this after any change to a Dockerfile or to source code. The `--build` flag forces a rebuild even if Docker thinks the cached image is current.

```bash
docker compose up --build
```

### `docker compose up -d`

Starts all containers in detached mode. No log output in the terminal; the command returns immediately. Use this when you want the stack running without occupying the terminal session.

```bash
docker compose up -d
```

### `docker compose down`

Stops and removes all containers and the default Compose network. Named volumes are not touched — database data is preserved. Use this for a normal shutdown.

```bash
docker compose down
```

### `docker compose down -v`

Stops and removes all containers, the network, and all named volumes. This permanently deletes the `sqldata` volume and every row in every table. Use this only when you need a completely clean slate — for example, to test the full migration from scratch, or to reset to a known empty state.

```bash
docker compose down -v
# All data in CrudVaultDb is gone after this.
```

### `docker compose logs -f api`

Streams live log output from the named service. `-f` follows the stream (like `tail -f`). Replace `api` with `db` or `frontend` to follow other services. Essential for watching EF Core migration output, startup errors, and request logs in real time.

```bash
docker compose logs -f api
docker compose logs -f db
docker compose logs -f frontend
```

### `docker ps`

Lists all running containers with their IDs, names, status, and port mappings. Confirms that all three containers are up and shows how long they have been running.

```bash
docker ps
```

### `docker images`

Lists all images on your machine with their repository, tag, ID, and size. After building, look at the sizes of `crudvault-api` and `crudvault-frontend` to see the effect of multi-stage builds — they will be significantly smaller than their build-stage counterparts.

```bash
docker images
```

### `docker exec -it crudvault-api-1 sh`

Opens an interactive shell inside a running container. Useful for debugging the container filesystem and environment. The container name comes from `docker ps`. The `aspnet:9.0` image provides `sh`, not `bash`.

```bash
docker exec -it crudvault-api-1 sh

# Inside the container — useful commands:
env | grep DB          # verify environment variables were injected
ls /app                # confirm the published files are present
exit
```

### `docker volume ls`

Lists all Docker volumes on the host. Confirms that `crudvault_sqldata` was created after the first `docker compose up`.

```bash
docker volume ls
```

### `docker volume inspect crudvault_sqldata`

Shows metadata about the volume: its driver, mount point, and creation time. On Linux the mount point is a real path on the host filesystem. On Docker Desktop (Mac/Windows) the path is inside the Docker Desktop VM and not directly accessible from the host.

```bash
docker volume inspect crudvault_sqldata
```

### `docker stats`

Displays a live table of resource usage for all running containers — CPU percentage, memory usage, network I/O, and block I/O. Useful for spotting a container consuming unexpected memory or CPU. Exit with `Ctrl+C`.

```bash
docker stats
```

---

## Rebuild vs Restart

### When you need `--build`

Use `docker compose up --build` after changing anything that goes into a Docker image:

- Any line in `backend/Dockerfile` or `frontend/Dockerfile`
- Any source file: `*.cs`, `*.tsx`, `*.ts`, `*.css`
- `package.json`, `package-lock.json`, or `.csproj`
- `nginx.conf`
- `appsettings.json`

Without `--build`, Compose starts the existing cached image. Your code changes have no effect.

### When `--build` is not needed

You do not need `--build` after:

- Changing `docker-compose.yml` environment variables — the image is unchanged; new values are injected at container start time.
- Changing `.env` or `db.env` — same reason; these are resolved at startup, not baked into the image.
- Stopping and starting the stack with `docker compose down` then `docker compose up` — the images are already built.

In those cases, `docker compose up` (no `--build`) starts the existing images with the current configuration.

### How the cache behaves in practice

Docker evaluates each Dockerfile instruction top to bottom. The first instruction whose input has changed invalidates its cache entry and every instruction below it.

**Scenario: you edit `src/App.tsx`**

```
COPY package*.json .   → cache HIT   (lock file unchanged)
RUN npm ci             → cache HIT   (dependencies unchanged)
COPY . .               → cache MISS  (source files changed)
RUN npm run build      → rebuilds    (downstream of miss)
```

Result: `npm ci` is skipped. Only the Vite build reruns. Build time is a fraction of a full rebuild.

**Scenario: you add a new npm package**

```
COPY package*.json .   → cache MISS  (package-lock.json changed)
RUN npm ci             → rebuilds    (must install new dependency)
COPY . .               → rebuilds
RUN npm run build      → rebuilds
```

All four layers rebuild because the first one changed.

**Scenario: you edit `backend/Controllers/ItemsController.cs`**

```
COPY *.csproj .        → cache HIT   (project file unchanged)
RUN dotnet restore     → cache HIT   (dependencies unchanged)
COPY . .               → cache MISS  (source files changed)
RUN dotnet publish ... → rebuilds
```

Result: `dotnet restore` is skipped. Only the compile and publish steps run.

---

## Troubleshooting

### Container exits immediately after starting

**Symptom:** One or more containers are missing from `docker ps` output immediately after `docker compose up`.

**Diagnosis:**

```bash
docker compose logs api
docker compose logs db
docker compose logs frontend
```

Read the full output. The last few lines before exit usually contain the error. Common causes:

- **`db` exits**: `db.env` does not exist, or `MSSQL_SA_PASSWORD` does not meet SQL Server complexity requirements (needs uppercase, lowercase, digit, and symbol; minimum 8 characters).
- **`api` exits**: EF Core migration failed — usually because `DB_PASS` does not match `MSSQL_SA_PASSWORD`, or the `db` container was not healthy when `api` started.
- **`frontend` exits**: nginx configuration syntax error. Run `docker compose logs frontend` to see the nginx error.

---

### API cannot connect to the database

**Symptom:** API starts but returns 500 errors, or logs show a SQL client connection exception.

| Cause | Fix |
|---|---|
| `DB_PASS` in `.env` does not match `MSSQL_SA_PASSWORD` in `db.env` | Open both files and make the values identical. Then `docker compose down -v && docker compose up --build` (the volume must be wiped if SQL Server already initialised with a different credential). |
| `db` volume was initialised with a different credential | `docker compose down -v` to wipe the volume, then set consistent credentials and restart. |
| `db` not yet healthy when `api` started (health check misconfigured) | Check `docker compose logs db` for health check output. Confirm the `depends_on condition: service_healthy` is present in `docker-compose.yml`. |
| Wrong `DB_HOST` value | Must be `db`. Confirm in `docker-compose.yml` under `api: environment:`. |

---

### Port already in use

**Symptom:** Compose fails with `bind: address already in use` for port 3000, 5000, or 1433.

**Find what is using the port:**

```bash
# Linux / Mac
lsof -i :3000

# Windows (PowerShell)
netstat -ano | findstr :3000
```

Then stop the process, or change the host-side port in `docker-compose.yml`. The format is `HOST:CONTAINER` — only the left side needs to change:

```yaml
ports:
  - "3001:80"   # host 3001 instead of 3000
```

Then access the app at `http://localhost:3001`.

---

### Image build fails

**Symptom:** `docker compose up --build` stops during the build phase with a non-zero exit code.

**How to read it:**

Docker prints each layer as it runs. Find the first line showing an error or non-zero exit. Everything above succeeded; the problem is in that layer.

| Layer | Common cause | Fix |
|---|---|---|
| `RUN dotnet restore` | Package name/version does not exist; network issue | Check package names and versions in `.csproj` |
| `RUN npm ci` | `package-lock.json` out of sync with `package.json` | Run `npm install` locally and commit the updated lock file |
| `RUN dotnet publish` | C# compile error | The output names the file and line number. Fix the code. |
| `RUN npm run build` | TypeScript error or Vite config error | The output names the file. Fix the code. |

If the build works locally (`dotnet build` or `npm run build`) but fails inside Docker, the most likely cause is a file that exists on your machine but is excluded from the Docker build context by a `.dockerignore` rule. Check `.dockerignore` for entries that might be excluding something the build needs.
