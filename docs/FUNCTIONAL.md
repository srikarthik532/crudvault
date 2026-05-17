# CrudVault — Functional Specification

## Overview

The application presents a single-page interface where a developer can manage a list of items. Each item has a title, an optional description, and a status. The UI is a dark-themed dashboard with animated transitions powered by Framer Motion.

---

## Item Model

| Field         | Type      | Required | Notes                                         |
|---------------|-----------|----------|-----------------------------------------------|
| `id`          | integer   | yes      | Auto-incremented by SQL Server                |
| `title`       | string    | yes      | Non-empty; `nvarchar(max)` in SQL Server      |
| `description` | string    | no       | Optional free text; `nvarchar(max)`, nullable |
| `status`      | string    | yes      | One of: `Active`, `Inactive`, `Archived`      |
| `createdAt`   | datetime  | yes      | Set by the API on creation; UTC               |
| `updatedAt`   | datetime  | no       | Set by the API on update; UTC; nullable       |

### Status Values

| Status     | Meaning                                            | Badge Color              |
|------------|----------------------------------------------------|--------------------------|
| `Active`   | Item is current and in use                         | Green (`emerald-100/700`) |
| `Inactive` | Item exists but is not currently in use            | Amber (`amber-100/700`)  |
| `Archived` | Item is retained for reference but is no longer active | Slate (`slate-100/600`) |

Status defaults to `Active` when a new item is created without specifying a status.

---

## Features

### Stats Bar

Displayed at the top of the main content area. Three cards, one per status value, each showing the count of items currently in that status. Updates immediately after any create, update, or delete operation — no page reload required. Animates in on page load (fade + slide down via Framer Motion).

### Item List

Items are displayed as a vertical list of cards, ordered by `createdAt` descending (newest first). Each card shows:

- Title (truncated if overflow)
- Status badge with color coding
- Description (if present; clamped to 2 lines)
- Creation date (formatted as locale date string)
- Edit and Delete buttons (visible on hover only)

List items animate in and out using spring physics (`stiffness: 300, damping: 30`). New items slide in from the left; deleted items slide out to the right and collapse. The list reflows smoothly when items are added or removed via `AnimatePresence` and `layout` animation.

### Create Item

Triggered by the "New Item" button in the header. Opens a modal form. Fields:

- **Title** — required text input
- **Description** — optional textarea (3 rows)
- **Status** — select dropdown with options: Active, Inactive, Archived; defaults to Active

On submit, sends `POST /api/items`. The new item is prepended to the local list immediately on success (no full reload). The modal closes and the form resets to empty state.

### Edit Item

Triggered by the "Edit" button on a card (visible on hover). Opens the same modal form pre-populated with the item's current values. Submits `PUT /api/items/{id}`. On success, the item is updated in-place in the local list. `createdAt` is not editable.

### Delete Item

Triggered by the "Delete" button on a card (visible on hover). No confirmation dialog. Sends `DELETE /api/items/{id}`. While the request is in flight, the button shows `…` and is disabled. On success, the item is removed from the local list with an exit animation.

---

## Modal Behavior

- Opening the modal animates it in: scale from 0.95 to 1, fade in, slide up 20px (spring animation).
- Closing animates the reverse.
- Clicking the backdrop (outside the modal panel) closes the modal without submitting.
- Clicking Cancel closes the modal without submitting.
- The modal is accessible via `z-50` and a `bg-black/60 backdrop-blur-sm` overlay.

---

## Loading State

On initial page load, a spinning ring indicator is centered on screen while `GET /api/items` is in flight. The ring is animated with a continuous 360-degree rotation.

---

## Empty State

When the API returns an empty array, the list area shows:

- A mailbox icon
- "No items yet" heading
- "Create your first item to get started" subtext

This state animates in with a fade. It is replaced immediately when the first item is created.

---

## Error State

If `GET /api/items` fails (network error, API not running), an error banner appears above the list area:

> "Failed to load items. Is the API running?"

The banner uses a red tinted background (`red-500/10`) with a red border and red text. It does not auto-dismiss. No retry mechanism is implemented in the UI — the developer must refresh the page manually.

If a create, update, or delete operation fails, the error is not currently surfaced to the user. The operation silently fails.

---

## Hover Interactions

The Edit and Delete buttons on each item card are hidden by default (`opacity-0`) and become visible on hover (`group-hover:opacity-100`). This is implemented with Tailwind's `group` and `group-hover` utilities. The background of the card itself lightens slightly on hover (`bg-white/[0.08]`).

---

## Routing

There is no client-side routing. The application is a single view. The nginx configuration serves `index.html` for all non-API, non-static-asset routes, enabling future client-side routing without server configuration changes.

---

## Data Flow Summary

```
User action
    │
    ▼
App.tsx (React state)
    │
    ▼
src/api.ts (axios, baseURL: /api)
    │
    ▼ HTTP via nginx proxy (in Docker) or Vite proxy (in dev)
    │
    ▼
ASP.NET Core API (:8080 inside Docker, :5000 on host)
    │
    ▼
EF Core → SQL Server (CrudVaultDb database)
```
