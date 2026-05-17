# CrudVault — Product Requirements Document

## Purpose

CrudVault is a full-stack CRUD web application built to demonstrate and learn Docker-based deployment. It is not a production SaaS product. The application itself is intentionally simple — create, read, update, and delete items — so that all complexity lives in the infrastructure layer, not the business logic.

## Target User

A developer who is technically strong in C# and/or React and wants to understand:

- How to containerise a multi-service application with Docker Compose
- How secrets are kept out of source control in a containerised environment
- How networking works between containers (API, database, frontend)
- How multi-stage Docker builds work for .NET and Node.js

The user is not a Docker beginner in the sense of being unfamiliar with programming — they are a Docker beginner in the sense of not having containerised a real application before.

## Problem Being Solved

Most Docker tutorials either use toy single-container examples or throw a production-grade `docker-compose.yml` at you without explaining the decisions. CrudVault occupies the middle ground: a real multi-container application (frontend, API, database) with real credential management, real health checks, and a real build pipeline — but with a deliberately minimal feature set so there is nothing to distract from the infrastructure lessons.

## Goals

1. Run the entire stack — database, API, frontend — with a single `docker compose up --build` command.
2. Demonstrate credential isolation: the SQL Server SA password never appears in any committed file.
3. Demonstrate container networking: the frontend talks to the API by service name, not by IP or localhost.
4. Demonstrate multi-stage builds: the shipped images contain only runtime artifacts, not build tools.
5. Demonstrate startup ordering: the API does not start until the database passes a health check.
6. Implement a complete CRUD cycle against a real SQL Server database via EF Core.

## Non-Goals

- User authentication or authorisation of any kind.
- Production readiness (the SA user is used directly; this is intentional for simplicity).
- Scalability, load balancing, or horizontal scaling.
- Any business domain beyond a generic item with title, description, and status.
- Mobile responsiveness beyond what Tailwind provides by default.
- Pagination, search, or filtering of the item list.

## Success Metrics

The project is successful when:

- `docker compose up --build` from a clean checkout (after creating the two env files) produces a working application at `http://localhost:3000`.
- All five CRUD operations work end-to-end through the UI without manual intervention.
- Restarting the stack (`docker compose down` then `docker compose up`) preserves all data via the named volume.
- The three committed files contain no secrets, passwords, or connection strings with embedded credentials.

## Constraints

- The SQL Server image requires the SA password to meet complexity requirements (uppercase, lowercase, digit, special character, minimum 8 characters).
- The SQL Server container takes approximately 20–30 seconds to become ready. The health check accounts for this with a 30-second `start_period`.
- The `.NET SDK 9.0` and `node:22-alpine` images are required as build stages. The runtime images (`aspnet:9.0` and `nginx:alpine`) are much smaller.
- CORS is restricted to three specific origins. Requests from any other origin are rejected by the API.

## Assumptions

- Docker Desktop (or Docker Engine + Compose plugin) is installed on the host machine.
- The developer creates `db.env` and `.env` manually from the provided `.example` files before running `docker compose up`.
- The same password value is used in both `db.env` (as `MSSQL_SA_PASSWORD`) and `.env` (as `DB_PASS`). If they differ, the API cannot connect to the database.
- Port 3000, 5000, and 1433 are available on the host machine.
