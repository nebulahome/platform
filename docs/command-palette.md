# Command palette (Ctrl+K)

Status: specified, not built. Written 2026-11-16 after a brainstorm with the owner and a read of the
current web UI. Everything under "Decided" is the owner's call; do not re-open it. Everything under
"To verify" is something the spec could not settle from reading code: settle it in the code first.

Design, 2026-11-16: the boards are on the canvas "Nebula Home | Platform Flow", page "Command palette · Ctrl K"
(`N-Command-Palette-*`, generator in `D:\Projects\NebulaHome\design\command-palette\`). Behaviour, keys, states and
motion are settled there and written back here. **The look is settled too** (owner, 2026-11-16, after thirteen
variants): "Horizon Deep Soft", dark glass with one still line of light on the top edge. Every board is drawn in it
since canvas version 297 and section 12.3 describes it. What the owner turned down on the way, so it is not proposed
again: the first design (too standard), a second pane with the entity's controls, results as tiles, moving light,
glows and gradients, glass lighter than the theme's surfaces.

All paths are under `platform/` (web UI: `apps/web-ui/src`, abbreviated `W/`; UI kit:
`packages/ui/src`, abbreviated `UI/`). Repo rules live in `../RULES.md` and `../CLAUDE.md` (root of
the monorepo); this spec repeats only the ones that bite here.

## 1. What it is

One search-and-act box, opened from anywhere in the signed-in app with **Ctrl+K** (Cmd+K on macOS),
that finds entities, devices, scenes, automations, pages, settings, installed integrations and
packages, and also runs a small set of actions ("New automation", "Add device Shelly") and
one-key quick actions on results (turn a light on, apply a scene, enable an automation).

It only ever shows what the signed-in person may see or do.

It is navigation first. If a result has no sensible destination, it is not a result.

## 2. Decided

1. **Shortcut: Ctrl+K and Cmd+K, on every platform.** Not Ctrl+Enter (it means "submit" in text
   areas and in the automation formula editors, and nobody discovers it).
2. **A visible trigger.** A "Search Ctrl K" row in the sidebar. Touch devices (phones, wall
   tablets) have no shortcut, so without the button they would never find the feature.
3. **Closed over dialogs, with one exception.** It does not open while a form dialog is open (a
   half-filled form must not be lost). It does open over the **entity dialog** (`?entity=`), because
   "I am looking at one light, take me to another" is a core use. See 5.3.
4. **Scope.** Entities, devices, scenes, automations, settings, installed integrations and packages
   are in. Tags are in only as a filtered list (no per-tag page exists). The Hub catalogue (things not
   installed) is **not** searched: one closing row sends the person to it (see 6.4).
5. **Actions are few and curated** (section 7). No free-text commands ("turn on the kitchen lights").
6. **Quick actions on results** are in scope (section 8). Enter opens or applies, a second key does
   the action, and the hint for each is always shown on the active row.
7. **Add device is per integration**, not generic. See section 9.
8. **Motion.** No rule against UI animation. The boards decide it and section 12.5 has the numbers: quicker
   than `Modal` (160 ms in, 110 ms out, against 220 and 170), one highlight that slides between rows, a list
   that never animates between two queries. Nothing may make a key wait. Respect the kit's reduced-motion rule
   (`[data-motion='reduced']` and the media query).
9. **Permissions.** Nothing a person may not read is fetched into the client for the palette (section 10).
10. **Language.** English in code, Italian in `locales/it.json`. The search is accent- and
    case-insensitive and matches the translated labels.
11. **No phone layout for now** (owner, 2026-11-16: not sure it makes sense on a phone). Build for a pointer
    and a keyboard. The sidebar row stays, so a touch screen can still open the palette and tap a row, but no
    full-screen sheet, no per-row icon buttons, no touch-only rules. The two `Phone-*` boards are parked.
12. **An id in the clipboard** (owner, 2026-11-16). When the palette opens and the clipboard holds the id of an
    entity, a scene, an automation (or an area, tag, device), that item is the first row, already active. Only
    for real ids of this house, only with an empty field, and the browser is never made to ask for permission
    by opening the palette. See 6.5.

## 3. Phases

Build in this order; each phase is shippable alone.

- **Phase 1 - Find and go.** Store, shortcut, sidebar trigger, palette UI, all result kinds,
  ranking, recents, settings-index extraction, gallery page, tests. The clipboard row (6.5) comes last in this phase, as
  its own PR, with the "Copy id" buttons it depends on.
- **Phase 2 - Do.** Global actions, quick actions on results, per-integration "Add device"
  (including the `?add=1` deep link on the vendor page).
- **Phase 3 - Extensible (do not build now).** Packages and integrations registering their own
  results and actions through the SDKs. Only keep the result type open enough that this can come
  later (section 11.2: sources are small modules returning the same `PaletteItem`).

## 4. Result kinds

`P` = permission needed to see the kind at all. The server enforces; the client check only decides
what to fetch and show. Primary = what Enter does. Secondary = what Tab does.

| Kind        | Source                                                | P                      | Matches on                                                          | Row (title / second line)                            | Primary (Enter)                                                           | Secondary (Tab)                                                 |
| ----------- | ----------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Entity      | `useEntityDirectory()`                                | `entity:read`          | name, entityId, area name, device name, `searchAliases`, kind label | name / device · area; state on the right (mono)      | `navigate(entityPath(id))`                                                | turn on/off, if commandable and `entity:control` for its scopes |
| Device      | `fetchDevices` list                                   | `device:read`          | name, manufacturer, model, area, vendor                             | name / manufacturer model · area                     | `navigate(devicePath(id))`                                                | none                                                            |
| Scene       | `fetchScenes` list                                    | `scene:read`           | name, area                                                          | name / area · N members                              | **apply** if `scene:apply`, else open                                     | open `/scenes/:id` (only when Enter applies)                    |
| Automation  | `fetchAutomations` list                               | `automation:read`      | name, description                                                   | name / On or Off, and a warning if `missingEntities` | open `/automations/:id`                                                   | enable / disable, if `automation:write`                         |
| Page        | static table + `reachableTree(can)` + dashboards list | per page (see below)   | label, description                                                  | label / where it lives                               | navigate                                                                  | none                                                            |
| Setting     | shared settings index                                 | per settings page      | title, note                                                         | title / page › section; note                         | `path?highlight=<id>&at=<n>`                                              | none                                                            |
| Integration | `fetchVendors`, installed or configured only          | `integration:read`     | name, description                                                   | name / N devices, status                             | `/integrations/:vendorId`                                                 | **Add device** when eligible (section 9)                        |
| Package     | `useInstalledPackages()`                              | `package:read`         | name, description, category                                         | name / category, state                               | `/packages/:id`                                                           | none                                                            |
| Tag         | `useTags()`                                           | `tag:read`             | name                                                                | name / N devices, M entities                         | `/devices?q=<tag name>` (the device list's `q` already matches tag names) | none                                                            |
| Action      | static table + generated "Add device X" rows          | per action (section 7) | label                                                               | label / one line                                     | run                                                                       | none                                                            |

Notes:

- **Row shape (boards):** one line, 48 px. "title / second line" in the table means the title and, after it on
  the same line, the second text in `text-foreground/45`. The state is at the right, always in
  the same place. A query word is marked (brighter and medium, no box) in the title; in the second text only when the title does not have it.
- **Entities:** the registry call is fetched with `includeHidden=true`. Drop `isHidden` and
  `!isEnabled` entities in the palette: hidden ones are hidden on purpose.
- **Pages** (the "Go to" group): Dashboards, Automations, Scenes, Devices, Aliases, Tags, Areas,
  Integrations, the brokers (`/brokers/*`), Packages, Containers, plus each dashboard by name
  (`/dashboards/:dashboardId`) - dashboards are my addition, cheap and obviously useful. Each page
  is gated by the same key as its route or sidebar row (`session-routes.tsx`, `sidebar.tsx:80-165`:
  e.g. `tag:read`, `area:read`, `integration:read`, `device:read` for brokers, `package:read`,
  `container:read`). Settings pages come from `reachableTree(can)` (`W/routes/settings/settings-tree.ts`).
- **Areas** are not in the owner's list. They are a natural "find a room" target and cost one source
  module: `/devices?area=<key>`, gated by `area:read`. Include them in the Pages group; the
  owner may drop them.
- **Not in the palette:** the permission catalogue (it stays in the settings search), logs,
  history, statistics, containers' images, Hub results.

### Entity state on the row

Show the state on the right in mono (`On`, `21.5 °C`), read from `useLive` readings
(`W/live/live-store.ts`). Reuse the entity picker's formatting; do not write a second formatter. That is
`readingOf(entity, live)` (`W/library/entity-reading.ts`) rendered by `<EntityStateSummary>`
(`W/routes/library/entity-state-summary.tsx`), as the picker row does (`entity-picker-tree.tsx`).
`describeState` alone is not enough: the component is what writes "Unavailable" (never a stale value),
"Updating…", and a numeric sensor as figure plus unit.

The board `Kinds` draws one row for every kind, with the text that formatter produces today:

- on/off kinds (light, switch, a fan or an alias with `on_off`): `On · 60%`, `On · 80% · 2700 K`, `Off`. These
  are the only rows with Tab (section 8).
- numeric sensor and `number`: `21.5 °C`, `58%` (no space before `%`), the unit in `text-foreground/45`. Text
  sensor and `select`: the value itself.
- binary sensor: the words of its class (`Open`/`Closed`, `Detected`/`Clear`, `Occupied`/`Clear`, `Wet`/`Dry`,
  ...). The resting state is in `text-foreground/45`, like `Off`.
- cover `Open 60%`, `Open 35% · Opening`, `Closed`; lock `Locked`/`Unlocked`/`Jammed`; climate
  `21.5 °C → 22 °C · Heating`; media player `Playing · 40% · <title>`; camera `Streaming · Recording`; vacuum
  and lawn mower `Cleaning`, `In its station`, ...; update `Update available · 1.3.0`; button `Ready`; image
  `Picture`.
- no reading (`—`): location trackers, a fan's speed and custom entities have no branch in the formatter today.
  The row still opens the entity. Giving them a reading is a change to the formatter, not to the palette.
- the state is capped at 250 px with an ellipsis, so a long media title never takes the name's room.
- the icon is the entity's catalogue icon, or the default of its kind (`entityKindOf`,
  `W/library/entity-kind.ts`).

Covers, locks, media players, buttons and vacuums have commands, but **no Tab action here**: section 8 stays
on/off only (a door is not unlocked with one key from a search box). Add one only when the owner asks.

## 5. Opening and closing

### 5.1 Trigger

- Global `keydown` listener on `document`, mounted once by a hook (`use-palette-shortcut.ts`) called
  from `Shell()` (`W/routes/shell.tsx:65-84`), next to `<EntityDialogHost/>`. Shell exists only
  while signed in, sits inside the router, the query client and the session, and remounts on
  language change.
- Opens on `(event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'`, no alt, no shift.
  Ignore `event.repeat`. Always `preventDefault()` (browsers use Ctrl+K for the location bar or web
  search). Pressing it again while open closes it.
- Works while typing in a normal `input` or `textarea` (that is the standard behaviour of every
  palette). It does **not** act when the event target is inside a CodeMirror editor (`.cm-editor`) or
  another `contenteditable`: `routes/containers/yaml-editor.tsx`,
  `routes/library/aliases/alias-code-editor.tsx`, the Modbus template editor use it, and the
  editors own their keys. (See "To verify": decide with the owner if this should be relaxed.)
- Does nothing while a platform overlay is up (`[role="alertdialog"][aria-modal="true"]`:
  `W/components/platform-overlay.tsx`, `maintenance-overlay.tsx`).
- No other global key is added. The settings search keeps `/` (`settings-search.tsx`); there is no
  conflict (nothing in the app binds Ctrl+K).

### 5.2 State

A tiny store, `palette-store.ts`, with the same store library as `W/auth/session-store.ts`:
`{ isOpen, open(), close(), toggle() }`. The shortcut hook and the sidebar button both use it.

### 5.3 The dialog rule

There is no context or counter for "a dialog is open". The kit's `Modal` wraps a native `<dialog>`
(`UI/components/modal.tsx`), and the existing precedent is
`document.querySelector('dialog[open]')` (`W/lib/block-ui.tsx:193`).

Open the palette only if:

- there is no `dialog[open]`; **or**
- exactly one `dialog[open]` exists and the URL has the `entity` search param (`ENTITY_PARAM` from
  `W/routes/library/entity/entity-path.ts`) - that is the entity dialog.

Otherwise do nothing (still `preventDefault`).

Picking a result while the entity dialog is open just calls `navigate(...)`: `EntityDialogHost`
reads `?entity=`, so another entity replaces the dialog's content, and any other destination
removes the param by navigating away. Close the palette first, then navigate.

**Escape trap (the main technical risk).** Every open `Modal` registers its own `document` keydown
for Escape (`modal.tsx:372`) with no "topmost only" logic. A palette built as a `Modal` above the
entity dialog would close both on one Escape. Make the palette handle Escape in the **capture**
phase on its own element and `stopPropagation()`, and add a test that proves Escape closes only the
palette over the entity dialog. If `Modal` cannot be made to behave, a dedicated `<dialog>`
component built from kit pieces is acceptable here (RULES 15.3 prefers `Modal`; write one line in
the file header saying why).

### 5.4 Focus

On open, focus the input. On close without choosing (Escape, click outside, toggle), restore focus
to the element that had it before. After choosing, do not restore (the page changed).

## 6. Behaviour

### 6.1 Empty query

Two groups, no "everything" list:

1. **Recent** - the last 6 things opened from the palette (kind + id).
2. **Actions** - the first four eligible actions: New automation, New scene, Add device, Add
   integration.

Recents are stored in `localStorage`, keyed with the user id, in try/catch (it can be blocked).
Store only `{kind, id}`; on read, resolve against the current data and permissions and silently drop
what no longer exists or is no longer visible.

### 6.2 Typing

- Matching is all-words-any-order, accent- and case-insensitive: use `matchesQuery`, `queryWords`,
  `foldForSearch` from `W/lib/search-text.ts` (`foldForSearch` replaces the private `fold()` in
  `settings-search.tsx`; do not write a third one).
- **Ranking** (a pure function in `rank.ts`, one number per item; higher first): exact name match >
  name starts with the query > a word of the name starts with it > name contains it > matched only
  through secondary fields (area, device name, alias, description). Add a small boost for recents
  and a small penalty for disabled/off automations only when scores tie. A query word that matches
  nothing excludes the item.
- **Groups:** each kind is a group with a header (`font-mono text-label uppercase`, as in
  `settings-search.tsx`). Groups are ordered by the best score inside them, ties broken by this
  fixed order: Entities, Scenes, Automations, Devices, Pages, Settings, Integrations, Packages, Tags,
  Actions.
- **Caps:** 5 rows per group at first, 30 rows in total. If a group has more, its last row is
  "Show all (N)" (a selectable row: Enter expands that group in place up to 50; beyond that the row
  says to refine the search).
- **Performance:** the whole index is in memory (entities are already fetched in full by
  `fetchEntities`, which follows every cursor; the registry "fits in memory many times over"). Build
  the folded haystack per item once in a `useMemo` keyed on the data, filter with
  `useDeferredValue(query)`. No server search, no web worker.
- **No results:** "Nothing matches "x"" plus, when `integration:install` allows it, one row "Search the Hub
  for "x"", already active, that goes to `/integrations?hub=<x>`. The Hub catalogue is a dialog
  (`InstallIntegrationsDialog`) whose search is local state, so this needs a small change outside the palette:
  `IntegrationsPage` reads `hub` once, opens the dialog with that text in its search, and removes the param with
  `replace: true` (same pattern as `?add=1` in section 9).

### 6.3 Keyboard

| Key          | Does                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `Ctrl/Cmd+K` | open / close                                                                                    |
| Up / Down    | move the active row (wraps)                                                                     |
| Enter        | the active row's primary action                                                                 |
| Tab          | the active row's secondary action, when it has one (`preventDefault`; focus stays in the input) |
| Escape       | close                                                                                           |
| Home / End   | not handled (they move the caret in the input)                                                  |

The active row follows the pointer on hover (as in the settings search) and the keyboard otherwise.
The first row is active on every query change.

### 6.4 Footer hints

A bar at the bottom of the panel with the keys **for the active row** (the settings search footer is
the model): `↑↓ Move`, `↵ <primary>`, `Tab <secondary>` (only if there is one), `Esc Close`. Examples:
`↵ Open · Tab Turn on`, `↵ Apply · Tab Open`, `↵ Open · Tab Disable`, `↵ Go to`.

The active row also carries its secondary action as a real button (the label and the `Tab` key inside it,
`tabIndex={-1}`, focus stays in the input). It sits left of the state, so the state never shifts while moving
with the arrows, and a click on it does what Tab does. A row without a secondary action, or a person without
the permission for it, simply has no button. This is also how a pointer or a finger reaches the quick action;
there is no separate touch layout (Decided 11).

### 6.5 An id in the clipboard

Copy an id, press Ctrl+K: the thing is the first row. Boards: `Clipboard` and `Clipboard-Rules`.

**What shows.** With an empty query, a group "Clipboard" above "Recent" with exactly one row: the normal row of
that kind (same Enter, same Tab), active on open. The id is written in mono at the right of the group's name.
Typing the first letter replaces the group with results. Once the row has been opened from here, the same text
is not offered again until something else is copied (keep the last consumed text in memory, not in storage).

**What counts as an id** (a pure function, `clipboard-id.ts`; trim, one line, at most 128 characters):

| Shape                                                                                      | Example                                          | Looked up in                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------- |
| `<domain>.<object_id>`, domain in `ENTITY_DOMAINS` (`packages/contracts/src/entity-id.ts`) | `light.hallway_light`, `alias.downstairs_lights` | entities by `entityId`                            |
| UUID                                                                                       | `0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7e0`           | scenes, automations, areas, tags, devices by `id` |
| `area.<key>`, `tag.<key>`                                                                  | `area.living_room`                               | areas and tags (the scope form)                   |
| anything else                                                                              | a word, a sentence, a password                   | nothing: a plain word is never an id              |

The lookup runs against the lists the palette already has, after the permission gate of section 10: no row for
something the person may not read. Hidden and disabled entities are not offered here either.

**Where the text comes from**, in this order:

1. **The app's own Copy buttons.** `copyText` (`W/lib/clipboard.ts`) remembers the last value it copied in a
   module variable (this tab, memory only). Works everywhere, also on plain http, and asks nothing.
2. **The system clipboard**, `navigator.clipboard.readText()`, only when `globalThis.isSecureContext`, the method
   exists (the same guard as `routes/library/broker-matter/code-field.tsx`) **and**
   `navigator.permissions.query({ name: 'clipboard-read' })` answers `granted`. A hub is reached on
   `http://<host>:8080` or `https://<host>:8443`: on the first there is no clipboard API at all. Where the query
   throws or answers anything else (Firefox and Safari show a paste bubble on every read), do not read.
3. **Pasting into the field** always works and needs nothing: an exact id match is the first result whatever its
   kind (add each item's id to the ranking as an exact-only field; never match a fragment of a UUID).

**Asking once.** Where the answer of the query is `prompt`, the empty state ends with one quiet line, "See the
id you just copied as the first result." with "Allow" and "Not now". "Allow" calls `readText()` from the click,
which makes the browser ask. Either answer, or "Not now", and the line never shows again (a flag in
`localStorage`, keyed with the user id, in try/catch). Opening the palette never triggers the browser's prompt.

**Privacy.** Clipboard text that is not an id of this house is dropped in the same tick: not rendered, not
stored, not sent, not logged. Nothing about the clipboard leaves the browser.

**Needed outside the palette.** Today only the alias panel copies an id (`routes/library/aliases/alias-side.tsx`,
`copyText(alias.entityId)`). For the feature to be reachable, the entity dialog, the scene page and the
automation page need a "Copy id" item that goes through `copyText`. Small, and its own PR.

## 7. Global actions

Only these (a long list becomes noise; add more only when the owner asks). An action whose
permission is missing is not shown.

| Label                          | Does                                                                                                              | Permission            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------- |
| New automation                 | `navigate('/automations/new')`                                                                                    | `automation:write`    |
| New scene                      | `navigate('/scenes/new')`                                                                                         | `scene:write`         |
| Add device                     | `navigate('/integrations')` (what the Devices page button does today)                                             | `device:write`        |
| Add integration (Hub)          | `navigate('/integrations?hub=')`: the page opens its install dialog (see 6.2)                                     | `integration:install` |
| Sign out                       | `useSession((s) => s.signOut)`, as `UserChip` does (`sidebar.tsx:385`); icon `user-round`, the menu item has none | none                  |
| Per-integration "Add device X" | section 9                                                                                                         | `device:write`        |

Do **not** add separate actions for "Software & updates", "Users & permissions", "Theme",
"Language": they are already found as pages and settings rows.

## 8. Quick actions on results

- **Entity (on/off):** shown only for an entity with the `on_off` capability, commandable
  (`isCommandable(entity)`) and `can('entity:control', entityScopesOf(...))`
  (`W/library/entity-control.ts:131,160`, gate pattern in
  `W/routes/library/entity/use-entity-dialog.ts:154`). The command is
  `send('on_off', powerCommand(next))` - never `toggle`. `useEntityCommand(entityId)`
  (`W/routes/library/entity/use-entity-command.ts:53`) is per entity, does coalescing and error
  toasts, and re-reads state. Mount it in a small child component rendered only for the **active**
  row, so there is exactly one hook instance. The hint label says what will happen: "Turn off" when
  it is on, "Turn on" when it is off. After the command the palette **stays open** and the row's
  state updates live (that is the point); Escape closes. The row shows the live reading, never an
  optimistic one: the press is felt on the button, the state changes when the entity reports it. If no
  answer comes within 250 ms the `Tab` key inside the button becomes the spinner (`loader-circle`, in place
  of the glyph, never beside the word). A failed command shakes the row once and the error toast says why.
- **Scene:** Enter = `applyScene(id)` (`W/library/api.ts:338`), toasts from
  `W/library/scene-apply-toast.ts` (`toastSceneApplied` / `toastSceneFailed`, usage in
  `routes/library/scene-page.tsx:44-60`). The Enter mark becomes a check and the palette **closes**
  180 ms after the key, without waiting for the answer.
- **Automation:** Tab = `updateAutomation(id, { isEnabled })` (`W/library/api.ts:262`), seeding the
  cache and toasting "{{name}} turned on/off" exactly like `automations-page.tsx:126`. Stays open.
- Outcomes are toasts (RULES 15.7: title without a full stop, plus a `toMessage(error)` line on
  failure). Never a silent failure.
- Invalidate with `LIBRARY_QUERY_KEYS.entities` / `scenes` / `automations` after a write.

## 9. Add device is per integration

Today there is no single "Add device" dialog: the Devices page button just goes to `/integrations`,
and the real flow is the vendor page (`/integrations/:vendorId`, `vendor-page.tsx`, "Add device" ->
local `useState` -> `DeviceDialog`). Matter and the other brokers have their own dialogs. Nothing is
deep-linkable.

Design:

1. **Generic row** "Add device" in the global actions (section 7): goes to `/integrations`.
2. **Tab on an integration result** = "Add device" with that integration preselected.
3. **Verb query.** Typing "add shelly" / "aggiungi shelly" shows a generated row "Add device ·
   Shelly" whose Enter starts the flow. These generated rows are candidates **only** when the first
   query word is a prefix of the action label's first word (so a plain "shelly" shows the
   integration row, not a second "Add device · Shelly" row, and the empty state never lists 13 of
   them). Add a `requiresVerb` flag on the item; the ranking function honours it.
4. **Eligibility** (on `IntegrationVendorView`, `packages/contracts/src/integrations.ts`):
   `adoption !== 'automatic'`, not `needsSetup`, not `needsAccount`, not `needsPackage`, installed
   and enabled, and `can('device:write')`. This is the same condition the vendor page uses for its
   button (`canWrite && !isAutomatic` and the three `needs*` flags). Integrations that fail it
   simply have no Add-device action.
5. **Deep link (required change outside the palette):** `VendorPage` reads a new `?add=1` param
   once, opens `DeviceDialog` in `create` mode when the eligibility conditions hold, then removes the
   param with `replace: true`. If the conditions do not hold, it ignores the param. The palette
   navigates to `/integrations/:vendorId?add=1`. Add a test for the page.
6. **Brokers (Matter, Modbus, MQTT, Infrared, Bluetooth, Thread):** their add dialogs are local
   state on `/brokers/*` pages. **Phase 2 does not cover them**: the palette just opens the broker
   page. A `?add=1` on those pages is a later, separate change.

## 10. Permissions and privacy

- Client gate: `useSession((s) => s.can)` (`W/auth/session-store.ts:115`; it re-renders when the
  role changes). Do not fetch or show a kind without its key: queries use `enabled: can(key)`
  (the `useRailCounts` pattern, `W/lib/use-rail-counts.ts:77`). This means names of things a person
  cannot read never reach the client for the palette.
- `GET /entities` is already filtered per row by scope on the server (area, entity or tag scopes).
  Devices, scenes, automations, tags, areas, vendors and packages are all-or-nothing by key.
- `can(key, scopes)` is cosmetic: the API enforces. A denied command returns an error toast; never
  hide that by catching silently.
- Recents hold only `{kind, id}` and are validated on read (section 6.1).
- No telemetry on what was searched.
- The clipboard is read only as section 6.5 says; text that is not an id is never kept or shown.

## 11. Implementation

### 11.1 Extract first (no behaviour change)

Before the palette exists, in its own commit: move out of
`W/routes/settings/settings-search.tsx`:

- `SETTINGS_INDEX`, `SECTIONS`, `SettingEntry` -> `W/routes/settings/settings-index.ts`
  (data only; the search and the palette both import it).
- `marked()` -> a shared helper in `W/lib/` (the palette needs the same match highlight).
- Replace its private `fold()` with `foldForSearch` from `W/lib/search-text.ts`.
- If the result row JSX (icon chip, title with match, trail, line, Enter glyph) can be shared as
  one component without bending it, do that; otherwise copy the visual anatomy into the palette row
  and leave the settings search as it is.

The settings search must behave exactly as before; its tests stay green.

Settings in the palette: pages from `reachableTree(can)`, rows from `SETTINGS_INDEX` joined to their
page (`where` map as in `settings-search.tsx`), opened with
`${path}?highlight=${encodeURIComponent(id)}&at=${Date.now()}` (`SettingsRow` consumes `highlight`
and `at`, `routes/settings/settings-ui.tsx:275-311`). An entry whose page is not reachable is not
offered.

### 11.2 Files

New folder `W/palette/` (kebab-case, one component per file, `<Name>Props` in the same file):

```
palette/
  palette-store.ts          open/close/toggle
  use-palette-shortcut.ts   the keydown rule of section 5 (also exports the pure `canOpenPalette`)
  command-palette.tsx       the dialog: input, groups, footer; mounted once by Shell
  palette-row.tsx           one row (icon chip, title with match, second line, right side, hint glyph)
  palette-quick-action.tsx  child rendered for the active entity row; owns useEntityCommand
  palette-types.ts          PaletteItem, PaletteGroupId, PaletteAction
  use-palette-items.ts      builds items from the sources, permission-gated, lazy (only while open)
  rank.ts                   score(item, words) and ordering; pure
  palette-recents.ts        read/write recents (try/catch around localStorage)
  clipboard-id.ts           text in, { kind, id } or null out (the shapes of 6.5); pure
  use-clipboard-item.ts     reads the text (6.5, sources 1 and 2) when the palette opens, resolves it to an item
  sources/
    entities.ts devices.ts scenes.ts automations.ts pages.ts settings.ts
    integrations.ts packages.ts tags.ts actions.ts   (each: data in, PaletteItem[] out, pure)
```

`PaletteItem` (sketch, adjust names to RULES §6):

```ts
type PaletteItem = {
  id: string;                    // stable: `${kind}:${id}`
  kind: PaletteGroupId;
  title: string;
  secondary: string;             // the second line
  haystack: readonly string[];   // folded searchable fields, built once
  icon: ...;                     // catalogue icon, vendor logo or UiIconId
  requiresVerb?: boolean;        // generated "Add device X" rows
  primary: { hint: string; run: () => void };
  secondaryAction?: { hint: string; isReady: boolean; run: () => void };
};
```

Sources are small pure modules so Phase 3 can add registrations without touching the UI.

Data hooks to reuse (do not add new endpoints): `useEntityDirectory()`
(`routes/library/entity-picker/use-entity-directory.ts:43`: entities, devices, areas, icons, live
readings), `useTags()`, `useAreas()`, `useInstalledPackages()` (`W/packages/use-packages.ts:34`),
the fetchers in `W/library/api.ts` with `LIBRARY_QUERY_KEYS` (shared cache with the rest of the app),
the dashboards query (`['dashboards']`, `W/dashboard/api.ts:28`). Mount the queries only while the
palette is open, so the app is not slower for people who never use it. First open may show a quiet
loading line per group; the cache usually has everything already.

Scene, automation and vendor routes are inline strings in the code today: use inline strings or a
two-line local helper; do not refactor the routing for this.

### 11.3 Sidebar trigger

In `W/components/sidebar.tsx`, a row between the logo row (~line 619) and the Dashboards row (631),
using the shared `ROW` / `ROW_IDLE` classes (`h-10 rounded-field`), `AppIcon id="search"`, a `Fading`
label ("Search") and a `kbd` with the shortcut. Show `Ctrl K` or `⌘K` according to the platform
(`navigator.userAgentData?.platform` with a `navigator.platform` fallback; default `Ctrl K`).
Collapsed sidebar (72 px, `w-18`): icon only, with `title` and `aria-label` as `Row` does
(~line 284). Style the `kbd` like the one in `settings-search.tsx`
(`rounded-check border border-border-strong px-1.5 font-mono text-label text-foreground-subtle`).
As drawn on `N-Command-Palette-Sidebar-Trigger`: at rest the row has `border-border` and
`text-foreground-subtle`, so it reads as a field and not as a page; over and focused it takes
`border-border-strong bg-surface-raised text-foreground`; 10 px of space below it. The web UI has no
navigation for narrow screens (no drawer, no bottom bar): the sidebar, 72 px when collapsed, is the only way
in at every width, so this row is also what a touch screen uses.

### 11.4 Accessibility

Combobox pattern, as in the settings search: `role="combobox"` input, `aria-controls`,
`aria-expanded`, `aria-autocomplete="list"`, `aria-activedescendant` pointing at the active
`role="option"` (focus never leaves the input), groups as `role="group"` with `aria-labelledby` on
the header, a polite live region announcing "N results" (and "Nothing matches"). Visible focus,
colour never the only cue (the active row also has the Enter glyph), any motion honours
`prefers-reduced-motion`. Entity and device names get `translate="no"`.

### 11.5 i18n

`t('key', 'English')` in components, `defineMessage` in module-scope tables
(`W/i18n/messages.ts`). Every key is written out in full and added to `W/locales/it.json`
(plurals `_one/_many/_other`); follow the Italian glossary in `W/locales/README.md`. `pnpm lint`
runs `check:translations` and the ESLint rule `nebula/no-untranslated-text`. The generated
"Add device · {{name}}" label is one message with an interpolation, not two concatenated strings.

### 11.6 Icons

Use only icons that exist in `UI/icons/ui-set.ts`: `search`, `plus`, `play`, `power`, `package`,
`tag`, `house`, `layers`, `cpu`, `zap`, `settings`, `layout-dashboard`, `corner-down-left`,
`chevron-right`, `x`, `lightbulb`, `globe`, `key`, `moon`, `sparkles`, `clock`, `user-round`,
`app-window`. `command`, `keyboard`, `history`, `tags`, `log-out` do **not** exist. If one is truly
needed, add it to `ui-set.ts` and `packages/icons/catalogue.json` (`ui-set.test.ts` enforces the
pair); no inline SVG (RULES 15.4). Entities and devices use their own catalogue icon
(`useCatalogueIcons`, `routes/library/device-icon.tsx`); integrations use `VendorLogo`, packages
`PackageLogo` (`routes/packages/package-tile.tsx`).

## 12. Design

Boards come first and set the look; the implementation follows them. The design is made by the main
design session; implementation agents do not invent a different look (RULES 15.3: tokens only, no hex,
no arbitrary values, build from the kit).

### 12.1 Where and how

- Generator: `D:\Projects\NebulaHome\design\command-palette\` (outside `platform/` and outside git),
  following `design\sidebar-floating\build.mjs` and `design\weather\` (`build.mjs`, `lib.mjs`,
  `page.mjs`, `measure.mjs`, `index.mjs`). Cycle: `node build.mjs`, `measure.mjs` for PNG and
  heights, rebuild, `index.mjs`, publish to the canvas "Nebula Home | Platform Flow".
- Boards are static HTML with tokens lifted from existing boards (`platform/design/tokens.json`,
  `design/flow/html/N-Settings-Search*.html` is the closest sibling). Names: `N-Command-Palette-*`
  (see `design/flow/SCREENS.md` for the entry format: route, existing files, spec, copy; add the
  entries).
- **Render every board headless and compare with its siblings before publishing** (the owner
  rejected unchecked boards before). Light and dark follow whatever the sibling boards do.

### 12.2 Boards

As published on 2026-11-16 (canvas version 299), all `N-Command-Palette-*`, all in the chosen look. The variant
boards (`Var-*`) were removed from the canvas once the choice was made; their generator is still `variants.mjs`.

- **The palette**: `Live` (one loop in the app), `Empty`, `Results` (query "light").
- **Rows and sizes**: `Rows` (every kind with what Enter and Tab do, every state of a row), `Anatomy` (sizes,
  tokens, the key table).
- **States**: `Add-Verb`, `Group-Expanded`, `No-Results`, `Loading`, `Group-Error`.
- **Every kind of entity**: `Kinds` (one row per kind and per state, with the reading as the app writes it).
- **An id in the clipboard**: `Clipboard` (in the app), `Clipboard-Rules` (other kinds, the line that asks once,
  what counts as an id, where the text comes from).
- **Where it opens**: `Over-Entity`, `Sidebar-Trigger`.
- **Motion**: `Motion-Panel`, `Motion-Actions`, `Motion-Values` (the full table and the CSS to start from).
- **Parked**: `Phone-Empty`, `Phone-Results` (Decided 11).

The sample house and the UI on the boards are in English, as on the rest of the Nebula page.

### 12.3 Visual rules

The look is "Horizon Deep Soft": the theme's surface as dark glass, one still line of light on the top edge, the
page behind slightly out of focus. Every colour is an existing token at an alpha (`foreground` is `#eceefb`), so the
classes below are plain Tailwind opacity modifiers. The new values are the 26 px corner (the dialog's is 22: add a
radius token, do not write an arbitrary value) and the two blurs; put the panel, the light and the active row in
`UI/styles.css` as classes (`.palette-panel`, `.palette-light`, `.palette-active`), since a gradient and an inset
shadow are not utilities. The board `Anatomy` has every size measured on the drawing.

- Scrim: `bg-canvas/52` with `backdrop-blur` 3 px. Lighter than the dialog's `bg-scrim` because the blur already
  sets the page back.
- Panel: centred, 12vh from the top, 680 px wide, as tall as its rows up to `min(78vh, 700px)`; past that the
  list scrolls and fades out at the bottom edge; the field and the keys bar stay fixed. `bg-surface/84` over a
  28 px backdrop blur (saturate 1.4), `border-foreground/8`, 26 px corners, shadow `0 30px 80px -24px` black 85%
  plus `inset 0 1px 0 foreground/5`. Not lighter than this: glass brighter than the theme's surfaces was rejected.
- The light (the only decoration, and it never moves): on the panel's top edge a 1 px line,
  `linear-gradient(90deg, transparent, foreground/45 50%, transparent)`, and under it a glow 190 px tall,
  `radial-gradient(ellipse 64% 100% at 50% 0, primary/15, transparent 78%)`. Both are `aria-hidden`, absolutely
  placed, `pointer-events: none`, under the field and the list.
- Field: 68 px, no box (the panel is the field), `search` icon 20 px in `text-foreground/50`, text 20 px,
  placeholder "Search or run a command", `border-b border-foreground/7` below. **No `Esc` key in the field**: the
  keys bar already has it. While a list is still loading (after 150 ms) the search icon becomes the spinner.
- Rows: one line, 48 px, `rounded-inner` (14 px), 14 px gaps, `px` 10 left and 14 right. Icon chip 32 px, round
  (idle `bg-foreground/7 text-foreground/60`; active row `bg-primary/20 text-primary`; an entity that is on takes
  its own colour, e.g. lamp at 14%; unavailable `bg-foreground/4 text-foreground/30`). Title 15 px in
  `text-foreground/80`; a matched word is `text-foreground font-medium` with no box behind it (still a `mark`).
  Second text 12.5 px `text-foreground/45` on the same line. Right: the secondary action button (active row only:
  26 px, `rounded-pill`, `bg-foreground/7 border-foreground/12`, the `Tab` key inside), the state in `font-mono
text-mono-caption tabular` (`text-foreground/45` when off or unavailable), the `corner-down-left` glyph 15 px in
  `text-primary` (its place is kept on every row).
- Active row: a plain veil, `bg-foreground/8`, no border and no edge of its own (a line of light on its top edge
  was tried and read as a stray border). It is one separate element under the rows, so it can slide (12.5).
- Group names: 34 px, `font-mono uppercase` 10.5 px, `text-foreground/42`.
- "Show all" and the quiet lines (nothing found, a list that failed): 40 px.
- Keys bar: 44 px, `border-t border-foreground/7`, `text-caption text-foreground/50`; key chips 22 px,
  `bg-foreground/7 border-foreground/14 text-foreground/80`.
- A group still loading keeps its name and two placeholder rows; a group that failed keeps its name and one
  line ("Devices could not be loaded." with "Try again").
- Over the entity dialog: the palette's own scrim, blur included, covers the dialog; no special veil.
- No glow that moves, no gradient on rows, no illustration in the empty state.

### 12.4 Copy (English; the Italian goes in `it.json`)

Placeholder: "Search or run a command". Groups: "Recent", "Actions", "Entities", "Devices",
"Scenes", "Automations", "Pages", "Settings", "Integrations", "Packages", "Tags". Empty:
"Nothing matches “{{query}}”." Hub row: "Search the Hub for “{{query}}”". Expand row: "Show all
({{count}})". Quick-action hints: "Turn on", "Turn off", "Apply", "Open", "Enable", "Disable",
"Add device". Toasts reuse the existing ones. Clipboard: group "Clipboard"; the line "See the id you just
copied as the first result.", buttons "Allow" and "Not now".

### 12.5 Motion

The boards `Motion-Panel`, `Motion-Actions` and `Motion-Values` play each of these beside its numbers, and
`Motion-Values` has the CSS (tokens for `theme.css`, classes for `styles.css`). Curves: **enter**
`cubic-bezier(0.2, 0.8, 0.2, 1)` (the dialog's), **settle** `cubic-bezier(0.16, 1, 0.3, 1)` (popover, press),
**exit** `cubic-bezier(0.4, 0, 1, 1)`.

| What                                         | From → to                                                                                       | Time                      | Curve             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------- | ----------------- |
| Panel, opening                               | opacity 0 → 1, scale 0.97 → 1, translate 0 -8px → 0                                             | 160 ms                    | enter             |
| Scrim (its 3 px blur comes and goes with it) | opacity 0 → 1; closing 1 → 0                                                                    | 160 ms; 110 ms            | ease-out; ease-in |
| Rows on opening (first 8)                    | opacity 0 → 1, translate 0 6px → 0                                                              | 180 ms, delay 40 + 18 × n | enter             |
| Panel, closing                               | opacity → 0, scale → 0.98                                                                       | 110 ms                    | exit              |
| Highlight (arrow keys)                       | translate Y, height                                                                             | 110 ms                    | settle            |
| Row button                                   | opacity 0 → 1 on the row where the highlight rests                                              | 100 ms, delay 60          | ease-out          |
| Enter mark, chip tint, key labels            | opacity, colours                                                                                | 100 ms                    | ease-out          |
| Panel height (more or fewer rows)            | height                                                                                          | 140 ms                    | settle            |
| Row button pressed                           | scale 1 → 0.94 → 1 (`.press-scale`)                                                             | 120 ms                    | settle            |
| Icon chip, state changed                     | scale 1 → 1.12 → 1; colours                                                                     | 280 ms; 200 ms            | enter; ease-out   |
| State text, state changed                    | old: opacity → 0, 6 px up; new: from 6 px below                                                 | 120 ms; 160 ms, delay 60  | ease-in; settle   |
| Labels (Turn off ↔ Turn on)                  | crossfade                                                                                       | 120 ms                    | ease-out          |
| Waiting (no answer in 250 ms)                | `Tab` key → spinner, state to 55%                                                               | 100 ms                    | ease-out          |
| Row, command failed                          | translate X 0 → -4 → 4 → -2 → 0                                                                 | 240 ms                    | ease-out          |
| Enter mark, scene applied                    | check: opacity 0 → 1, scale 0.6 → 1; row flash primary 22% → the active row's `bg-foreground/6` | 140 ms; 180 ms            | settle; ease-out  |
| Show all                                     | new rows opacity 0 → 1, 4 px up, 14 ms apart; list height                                       | 140 ms; 180 ms            | enter; settle     |
| A list arrives                               | its rows opacity 0 → 1 (`animate-fade-in`)                                                      | 120 ms                    | ease-out          |

Rules:

- The light does not move: the line on the top edge, its glow and the scrim's blur only fade in and out with the
  panel and the scrim.
- Nothing waits for an animation. The input is focused in the frame the panel mounts; a key pressed during an
  animation is handled in that frame.
- Between two queries the rows do not animate at all: only the panel's height does.
- The highlight does not slide (it jumps) when the key is held (`event.repeat`), on a second press before the
  slide ends, under the pointer, past either end of the list and after a new query.
- The list scrolls the active row into view at once (`block: 'nearest'`), never smoothly.
- Closing reuses `Modal`'s clone-and-fade (`fadeOut`) with the palette's own, shorter keyframes. When Enter
  navigates, the route changes at once and the panel fades over the new page.
- Keyframes move `scale` and `translate`, not `transform` (same reason as `dialog-in`). In Tailwind v4 these are
  their own properties: `transition-[transform]` does not animate them.
- Reduced motion: every movement above is off, colour changes stay, the spinner becomes the kit's slow pulse.

## 13. Verification without signing in

The signed-in UI needs a login the agent cannot type. Add a **gallery page**
(`W/gallery-palette.tsx`, wired like the existing `gallery-*.tsx` files) that renders the palette
with sample data and fake permissions, and verify there: all states of 12.2, keyboard flow, hints,
motion (and reduced motion). Render it headless (Playwright's `headless_shell` over the DevTools protocol, then read
the PNG) and compare with the boards. Live checks in the real app are the owner's.

## 14. Tests

Next to the source as `*.test.ts(x)` (RULES 12.1), vitest 4 + jsdom + testing-library, English test
names, one behaviour each. Setup stubs `HTMLDialogElement.showModal/close`
(`W/testing/setup.ts`). Pattern: `W/components/sidebar.test.tsx` (mock `@/library/api` with
`vi.mock(..., async (original) => ...)`, seed `useSession.setState`, render inside
`QueryClientProvider` + `MemoryRouter`).

Must cover:

- `rank.ts`: exact > prefix > word-prefix > contains > secondary-field; accents and case; several
  words in any order; alias hit; a non-matching word excludes; `requiresVerb` rows appear only with
  the verb as first word ("add shelly" yes, "shelly" no, "aggiungi shelly" yes in Italian).
- Sources: a kind is absent without its key; hidden and disabled entities are dropped; the entity
  quick action needs `entity:control` for the entity's scopes (scoped grant for another area -> none);
  Add device absent for `adoption: 'automatic'` and for `needsSetup/needsAccount/needsPackage`;
  settings rows of an unreachable page are absent.
- `canOpenPalette` / shortcut hook: Ctrl+K and Cmd+K open; second press closes; ignored with a form
  dialog open; allowed over the entity dialog only; ignored inside `.cm-editor`; ignored with a
  platform overlay; `event.repeat` ignored; `preventDefault` called in every case.
- Component: arrows wrap; first row active after each keystroke; Enter navigates; Tab runs the
  secondary action and the palette stays open; Escape restores focus; "Show all" expands; no-results
  row; recents survive a reopen and drop vanished items; Escape over the entity dialog closes only
  the palette.
- `VendorPage` `?add=1`: opens the dialog when eligible, ignored otherwise, param removed.
- `clipboard-id.ts`: an entity id with a known domain, a UUID, `area.key` and `tag.key` are recognised; a plain
  word, an unknown domain, two lines, 129 characters and an empty string are not.
- Clipboard row: shown for an id that resolves and that the person may read; absent for an unknown id, for an
  entity outside the person's scopes, with a non-empty query, and after it was opened once; `readText` is not
  called outside a secure context or when the permission is not `granted`; the asking line shows only on
  `prompt` and never again after an answer.
- Regression: `settings-search` tests unchanged and green after 11.1.

Commands (from `platform/`, with the `rtk` prefix per CLAUDE.md; note `rtk pnpm typecheck` can say
"No errors found" on a failing monorepo, so check the exit code or use `rtk proxy`):

```bash
pnpm --filter @nebulahome/web-ui test
pnpm --filter @nebulahome/web-ui exec vitest run src/palette
pnpm --filter @nebulahome/web-ui typecheck
pnpm --filter @nebulahome/web-ui lint        # eslint + check:translations
pnpm format:check
```

Coverage floor for this code is 60% lines, 50% branches. There is no Playwright folder
(`apps/web-ui/e2e/` does not exist): do not add an e2e setup for this.

## 15. Repo rules that bite here

English only in code and comments (§1). TSDoc on every function: summary, `@param`, `@returns`, no
types in the tags (§4). Comments say why, no commented-out code, TODOs in the form
`TODO(handle): ... (#issue)` (§5). One component per file, under about 150 lines each, business
logic in hooks or `src/lib` (§15.1). Server data in TanStack Query, never mirrored into `useState`;
`useEffect` only for subscriptions with cleanup (§15.2). Real `button`/`a`/`input`, keyboard
reachable, `aria-label` on icon buttons (§15.5). Dates and numbers through `@/i18n/formatters`
(§15.6). Conventional Commits with scope from `commitlint.config.js` (`feat(web-ui): ...`, subject
at most 72 characters), PRs under 400 lines, so split as: (1) extract the settings index, (2)
store + shortcut + sidebar trigger + shell, (3) sources + ranking + palette UI + gallery, (4)
actions + quick actions, (5) vendor `?add=1`, (6) i18n and docs. **No AI attribution anywhere**
(RULES §17.2: no `Co-Authored-By` trailer for an assistant, no tool mentions in commits or PRs).
Do not push.

## 16. Out of scope

Hub catalogue results; searching individual setting fields beyond the existing index; history,
logs and statistics; free-text or natural-language commands; the permission catalogue; a per-tag or
per-area page; Add-device deep links on the broker pages; extensibility by packages (Phase 3);
server-side search; telemetry; a phone or touch layout (Decided 11); the light theme on the boards.

## 17. To verify in the code before building

Settled on 2026-11-16 by reading the code (not run):

1. **Hub catalogue**: it is `InstallIntegrationsDialog`, opened from `/integrations`
   (`routes/library/integrations-page.tsx`), search in local state, nothing in the URL. Hence the `?hub=`
   change in 6.2.
2. **Sign-out**: `useSession((s) => s.signOut)` (`auth/session-store.ts:468`). The menu item has no icon.
3. **Sidebar on narrow screens**: there is no narrow layout at all. See 11.3.

Still open:

4. **Escape layering**: can `Modal` host the palette over the entity dialog with a capture-phase
   Escape (5.3), or is a dedicated `<dialog>` needed.
5. **CodeMirror**: confirm with the owner whether Ctrl+K should open the palette inside the code
   editors (default in this spec: no).
6. **Dashboards** list hook and whether `/devices?area=<key>` and `/devices?q=` behave as read.
7. **`useEntityDirectory` cost** on a large house: it also subscribes to live readings; if it is
   heavier than the palette needs, build the entity list from the entities query alone and read live
   state only for the visible rows.
8. **Cost of the two blurs** (3 px on the whole page behind, 28 px under the panel) on the slow wall tablets: not
   measured. If opening drops frames there, drop the scrim's blur first (the panel is 84% opaque, so it survives
   without its own too).
9. **Device ids** (6.5): `DeviceView.id` is a slug in `api-registry.ts` while `EntityView.deviceId` is a UUID in
   `api-entities.ts`. Settle which one a device carries at runtime before matching devices from the clipboard; a
   slug is a plain word and must not be matched.
10. **"Copy id" buttons** (6.5): the owner expects ids to be copyable for entities, scenes and automations; in the
    code only aliases have the button. Confirm where they go.
