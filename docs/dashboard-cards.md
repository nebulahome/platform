# Dashboard cards, Add card, card settings, smaller screens

Build brief for the dashboard work designed on the redesign canvas, page **Dashboard · card e modifica**
(`https://claude.ai/artifact/4pCaH1weFogKWZ5JCZ2UNu`, version 309, 2026-11-17). It says what to build and
why each choice was made, so that whoever builds it does not have to guess from the pictures.

Read it with the boards open. Board names are in `code`. The generator of the boards is outside this
repository, in `D:\Projects\NebulaHome\design\dashboard-cards` (README there).

**Status of the choices.** Lines marked **(asked)** are what the owner asked for. Lines marked
**(proposed)** are the designer's choice, shown on the boards and not yet confirmed: build them as
written, but keep them easy to change. Section 10 lists them in one place.

---

## 1. What exists today

As read in the code on 2026-11-17. Check a path before relying on it.

| Thing          | Where                                                                                           | What it does                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Dashboard page | `apps/web-ui/src/routes/dashboard/dashboard-page.tsx`                                           | Read-only view, tabs per dashboard, "Edit layout" with `dashboard:manage`                                               |
| Editor page    | `routes/dashboard/dashboard-editor-page.tsx`                                                    | A separate route (`/configuration/dashboards/:id/edit`), not a toggle                                                   |
| Draft          | `routes/dashboard/dashboard-draft.ts`                                                           | zustand: `begin`, `change`, `select`, `end`; Done sends the whole layout with one PATCH                                 |
| Grid           | `routes/dashboard/dashboard-grid.tsx`, `dashboard/grid-engine.ts`, `dashboard/geometry.ts`      | Custom, 4 columns, rows of 100 px, 16 px gap, fluid column width                                                        |
| Sizes          | `dashboard/card-sizes.ts`                                                                       | `TILE` 1×1, `STRIP` 2×1, `CARD` 1×2, `SQUARE` 2×2, `LARGE` 2×3, `TALL` 2×4; `CARD_SIZES` per kind; `cardKindOf(entity)` |
| Card types     | `packages/contracts/src/api-dashboards.ts`                                                      | `entity`, `scene`, `clock`, `energy`, `package`, `container` (the group)                                                |
| Add card       | `routes/dashboard/add-card-dialog.tsx`                                                          | Kind grid, then the entity picker as a second modal; no size choice, no preview                                         |
| Card inspector | `routes/dashboard/card-inspector.tsx`                                                           | Fixed `aside` at the right, not draggable; entity, title, icon, size, "Place in", Remove                                |
| Narrow layout  | `dashboard-grid.tsx`, `narrowLayout` in `dashboard/dashboard-layout.ts`                         | Under 720 px of grid width: 2 columns, drawn only, never stored; editing is switched off                                |
| Package cards  | `packages/package-sdk` (`defineCard`, `CardProps`), `apps/web-ui/src/packages/package-slot.tsx` | Same React tree, error boundary, lazy chunk per card; manifest sizes `small`, `wide`, `medium`, `large`                 |

What does not exist: a preview of a card anywhere, a size choice when adding, a draggable panel that is
not tied to a package, a one-column layout, a way to see narrower widths while editing, size names in
the interface (it shows "2×1").

---

## 2. Sizes get names

The interface says **Tile, Strip, Card, Square, Large, Tall** and shows the cells beside the name
("Card 1×2"). The names are the constants already in `card-sizes.ts`; add one `sizeLabel()` next to
`sizeName()` and use it in the size menu, the settings panel and the Add card dialog. Package sizes map
as today: `small` Tile, `wide` Strip, `medium` Square, `large` Large.

---

## 3. One rule when the entity can do less — board `K-Capabilities`

> A control the entity lacks is not drawn. What is left moves up. A size with nothing left to show is
> not offered.

No disabled controls, no placeholders for a missing capability: the card simply has fewer parts.

| Kind                | When it lacks…     | The card…                                                                                                    | Sizes offered         |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------- |
| Light               | brightness         | is drawn as a switch (Tile: toggle and On/Off; Card: the round power button and the day's bars)              | Tile, Card. No Square |
| Light               | white and colour   | has brightness only: no swatches, no second slider                                                           | Tile, Card, Square    |
| Light               | colour only        | keeps brightness and the white slider, no swatches                                                           | all                   |
| Cover               | position           | shows the state in words in place of the percentage; no window drawing; Card has three wide buttons          | Tile, Card            |
| Cover               | stop               | has two buttons                                                                                              | all                   |
| Cover               | tilt               | has no tilt line                                                                                             | all                   |
| Thermostat          | more than one mode | has no mode switch                                                                                           | all                   |
| Thermostat          | a settable target  | only reads: target and mode as two rows of text                                                              | Card, Square          |
| Thermostat          | humidity           | drops the humidity reading                                                                                   | all                   |
| Media player        | cover art          | shows a plain tile with the note icon                                                                        | all                   |
| Media player        | seek / position    | has no progress bar and no times                                                                             | all                   |
| Media player        | previous, next     | draws only the buttons the player has                                                                        | all                   |
| Media player        | anything playing   | says "Nothing playing" and the last title; Play stays, the others are off                                    | all                   |
| Lock, vacuum, mower | battery            | drops the reading; nothing takes its place                                                                   | all                   |
| Vacuum              | rooms              | Square shows the last clean (finished, time, area) and one Start                                             | all                   |
| Vacuum              | locate             | has no Locate button                                                                                         | all                   |
| Camera              | a live stream      | says SNAPSHOT in place of LIVE, shows the time of the picture, and Refresh in place of Snapshot              | Square, Large         |
| Camera              | recording          | Large keeps the picture whole and drops the events row and Record                                            | Square, Large         |
| Sensor              | history            | keeps its size; the chart area says "The chart starts with the next readings"; min, average, max show a dash | all                   |

How to build it: `cardKindOf` already picks the kind from capabilities. Add, per kind, a function
`allowedSizes(entity)` that filters `CARD_SIZES[kind].sizes`, and use it everywhere `sizesOf` is used
today. Each card component reads the entity's capabilities and renders its parts conditionally. Do
not add a second component per variant.

The size menu (section "Sizes on offer" of the board) lists the sizes the kind has in general; the ones
this entity cannot fill are greyed and say what they need ("needs brightness"). Keep a small map
`kind → size → reason` beside `CARD_SIZES`. A card stored at a size it can no longer fill is drawn at the
largest size that fits (`snapSize` does this today at render time; keep it draw-only).

---

## 4. Six states every card shares — board `K-States`

The same six for every kind. Build them once in the shared card frame (`cards/card-parts.tsx`), not in
each card.

| State           | When                                     | What the card does                                                                                                                                      |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not reachable   | the entity is unavailable                | Icon chip grey, an "Offline" pill in the header, the last value dimmed, "last seen 13:20". Controls are drawn but disabled, so the card keeps its shape |
| No value yet    | the entity exists and has never reported | A dash, never a zero or an "Off". Controls work                                                                                                         |
| Disabled entity | switched off in Devices                  | Dashed edge like a removed entity. "Enable" only for who may manage devices; others read "Ask an admin"                                                 |
| View only       | the role lacks `entity:control` for it   | No toggle, slider or button is drawn. The value stays. A small eye in the header corner                                                                 |
| Sending         | a command went out and is not confirmed  | The control shows it at once (knob moved with a spinner, "Turning on…"). Other controls of that card are off until the answer                           |
| No answer       | no confirmation in time                  | The control goes back, the card says "Did not answer" in the danger colour with "Try again". The message leaves by itself                               |

**(proposed)** "in time" is 10 seconds and the message leaves after one minute. Both are sample
numbers: take them from one constant.

A removed entity keeps the existing `MissingCard` (board `K-All`, section "Missing entity").

---

## 5. New kinds — board `K-New`

Fan, Time, Date and Person are entity cards: add them to `ENTITY_CARD_KINDS`, `CARD_SIZES` and
`cardKindOf`. The others are new card types in the layout schema. Adding a type to the union keeps old
layouts valid, so `DASHBOARD_LAYOUT_VERSION` does not change. The field names below are a suggestion.

| Card        | Sizes               | Stored as                           | Notes                                                                                                                                                                                                            |
| ----------- | ------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fan         | Tile, Card, Square  | `entity`                            | On/off, speed in percent or in steps, presets, swing, direction. Section 3's rule applies: a fan with on/off only is a switch-like Tile                                                                          |
| Time · Date | Tile, Strip         | `entity`                            | Tile reads the value and how far away it is. With the `set` feature the Strip edits in place: the change is a draft and one "Set" sends the whole value (same rule as the entity sheet boards `N-Entity-Time-*`) |
| Person      | Tile, Card, Square  | `entity`                            | Home, Away or the zone's name. The map shows in Square only                                                                                                                                                      |
| Bars        | Strip, Card, Square | `entity` with `chart: 'bars'`       | For totals and prices: one bar per hour or day, the current one marked. For prices, low hours in the success colour and dear ones in the warning colour                                                          |
| Compare     | Square, Large       | new `compare` `{ entityIds[] }`     | Up to four sensors with the same unit. Each keeps the colour of its row                                                                                                                                          |
| Activity    | Card, Large         | new `activity` `{ scope }`          | Newest first, from `history.state_history`. Scope is the house, one area or picked entities. Read only                                                                                                           |
| Automation  | Tile, Strip         | new `automation` `{ automationId }` | Toggle, Run now, last run, next run when it has a time. A failed run stays red until the next good one                                                                                                           |
| Note        | Tile, Card          | new `note` `{ title, text, icon }`  | Text only, no entity. Editable by whoever may edit the dashboard                                                                                                                                                 |
| Shortcut    | Tile                | new `shortcut` `{ target }`         | A page, a package or a web address. An address outside the hub opens in a new tab and shows the outward arrow                                                                                                    |

Not here on purpose: Weather, Energy and Cameras bring their own cards with their package (Energy also
has its built-in `energy` type). A Heading card was dropped because it would not fit the 100 px rows;
a Group already gives a title.

---

## 6. Cards that gather entities — boards `K-Aggregate`, `K-Overview`

### 6.1 Together (lights, switches, covers, locks, thermostats)

One card that stands for many entities of the same kind. It is not a Group: a Group frames separate
cards; this is a single card with a single state.

Suggested shape: a new card type `together` with `domain` and `members`:

```ts
members:
  | { mode: 'rule'; areaId: string | null; exclude: string[] }   // null = the whole house
  | { mode: 'hand'; entityIds: string[] }
```

- **(proposed)** By rule is the default. The rule is resolved in the browser from the entity list each
  time the card draws, so a new light in the Kitchen joins by itself and a removed one leaves. By hand
  the list never changes alone; a removed member is dropped silently and the count goes down.
- The card counts ("4 of 6 on"), shows the average of the main value, and acts on all members at once.
- **(proposed)** Members that differ: a control stays if at least one member can use it, and its label
  says how many ("Brightness · 3 of 4"). The command goes only to the members that support it. If no
  member can dim, the card falls back exactly like a single on/off light (section 3).
- Members that do not answer are left out of the count and named apart ("3 of 5 on · 1 offline").
- Large lists the members, each with its own value and its own small switch. Square for switches and
  locks lists them beside the count; a sixth row turns into "and 2 more".

Per kind:

| Kind        | Reads                                                                                     | Acts                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lights      | how many are on, average brightness                                                       | the switch turns all on or off; brightness and white go to every member that has them                                                                       |
| Switches    | how many are on                                                                           | the switch turns all on or off                                                                                                                              |
| Covers      | the average position; "from 20 to 100%" when they differ; "3 of 5 open" without positions | Open, Stop, Close and the position slider go to all                                                                                                         |
| Locks       | "All locked" only when every lock is                                                      | **(proposed)** "Lock all" only. Unlocking is never offered for the group: it stays on each lock with its hold                                               |
| Thermostats | average and spread, how many are heating                                                  | **(proposed)** the target stepper moves every thermostat by the same step, so rooms keep their differences. When targets differ the stepper shows the range |

Send the commands one per member through the existing command path. Show "Sending" (section 4) until
every member answered; if some did not, say how many ("2 did not answer") with Try again for those only.

### 6.2 Summary

Counts what needs a look, across the house or one area: doors and windows open, lights on, batteries
low, updates ready, entities not reachable. Suggested type `summary` `{ what, areaId }`.

- Coloured only when the count is above zero; quiet (grey icon, success dot, "All closed") otherwise.
- One action at most: "All off" for lights, "Review" for updates. No action for the others.
- Tap opens the list of what was counted. Card size shows the first three inline.
- Strip is "the house at a glance": the five counts side by side.

### 6.3 Room

One area in one card. Suggested type `room` `{ areaId }`. Climate on top (the area's temperature and
humidity sensors, and the thermostat's action as a badge), then one row per group the area has: Lights,
Blinds, Speaker, Heating. Each row is a small Together card: it reads the count and has the one control
that matters. A row the area has nothing for is not drawn. Without a thermometer the Tile says what is
on.

### 6.4 Entity list and Quick actions

- **Entity list** (`list` `{ entityIds[] }`): entities of any kind as rows, each with its value or its
  one main control. Card holds four rows, Large six. Tap a row for the entity sheet.
- **Quick actions** (`actions` `{ items[] }`, an item is a scene, a button entity or a switch): plain
  buttons with no readings. Two in a Tile, four in a Strip, six in a Card. A switch stays lit while on.

---

## 7. Add a card — boards `N-Dashboard-Add*`

One dialog, two steps. It replaces `add-card-dialog.tsx` and the second modal of the entity picker.

### 7.1 Step 1: what to add

`N-Dashboard-Add`, `N-Dashboard-Add-Packages`, `N-Dashboard-Add-Search`

- Left: categories with counts (All cards, For one entity, Together, Summing up, From packages, Other).
  "From packages" shows only when an installed package offers cards, as today.
- Right: one tile per card kind. Each tile holds a **live preview**, the name, one line of what it is
  and the sizes it comes in.
- The search field looks in three places at once: entities (name, area, address), areas, card kinds.
  An entity row carries one button, the card that entity gets (`cardKindOf`). An area row carries
  three: Room, Lights together, Summary. Pressing a button goes to step 2 with that choice filled in.
- A package tile carries the package's name. Under the last package tile, a dashed row links to the
  Packages page.

### 7.2 Step 2: entity and size, with the card at every size

`N-Dashboard-Add-Entity`, `N-Dashboard-Add-Limited`, `N-Dashboard-Add-Together`, `N-Dashboard-Add-Package`

- Left pane, fixed: the entity (or the members, or the package's own fields), "It can" (the
  capabilities found, so the person sees why a size or a control is missing), Size as a list of radio
  rows, "Goes in" (the page or a group: today's "Place in").
- Right pane, on the dotted floor: the card **at its real size, once for each size on offer**, side by
  side and wrapping. Pressing a preview chooses that size, the same as pressing its row on the left.
  The chosen one has the accent ring and says "chosen".
- A size the kind has and this entity cannot fill stays as a dashed frame of that size with the reason
  ("Square needs brightness"). It cannot be chosen.
- The pane scrolls when the sizes do not fit (Large, Tall). Never scale the step-2 previews: the point
  is to see the real size.
- Foot: where it will land, Cancel, **"Add and choose another"**, "Add card".
  - "Add card" adds at the first free spot (`firstFit`, as today) and closes.
  - **(proposed)** "Add and choose another" adds, shows the house toast, and goes back to step 1. It
    replaces the multiple choice the entity picker gives today.

### 7.3 How a preview is drawn (asked: not pictures)

A preview is the real card component, not an image, so it can never drift from the card and package
cards work the same way.

Build one component, `CardPreview`, used by both steps:

```tsx
<CardPreview card={draftCard} size={TILE} mode="sample" | "live" scaleToFit={{ w: 236, h: 104 }} />
```

- It renders the same component `card-view.tsx` renders, inside a box of fixed pixels:
  `w × 267 + (w − 1) × 16` wide and `h × 100 + (h − 1) × 16` high (267 px is the column the cards are
  designed at; keep it as one constant).
- The box is `inert` and has `pointer-events: none`: a preview never sends a command.
- `mode="sample"` (step 1): the card gets a fixed sample entity for its kind from a fixtures file, with
  no request to the server. One fixture per kind, the ones drawn on `K-All`.
- `mode="live"` (step 2, once an entity is chosen): the card reads the real entity from the store, so
  the person sees their own light at 72%. The header of the pane says "Preview · live".
- `scaleToFit` (step 1 only) shrinks with a CSS transform to fit the tile. Never enlarge.

**Package cards.** The preview goes through the existing `PackageSlot` (same loader, same error
boundary), with one addition to the public SDK:

- `CardProps` gains `isPreview: boolean`. When true the card must draw itself with sample values, must
  not open streams or subscriptions, and must not send commands. Document it in `PACKAGES_DOCS.md` §6
  and bump `@nebulahome/package-sdk` by a minor.
- The manifest card gains an optional `preview: { options }`: the option values to use for the sample.
- The pane says "Preview · drawn by the package" and "sample values" instead of "live".
- A package whose SDK is older than this, whose chunk fails to load, or that is not running gets the
  neutral tile: the package icon, "No preview from this package", name and sizes. Adding still works.
- Load package previews lazily, when their tile scrolls into view: each one is a dynamic import.

### 7.4 Shell

Same shell as the install sheets (`N-Integrations-Install`): 1120 px wide, 860 px high at most, the
glow at the top, the 42 px search, the 64 px foot. Reuse the component the install sheet uses; do not
add a new modal size if that one already exists. Step 2's left pane is 372 px.

---

## 8. Card settings: a floating panel — boards `N-Dashboard-Card-Settings*`

Asked: floating, so the card can be watched while it is edited. It replaces the fixed `aside` of
`card-inspector.tsx`; the fields and their logic stay.

- **Opening**: in the editor, a click on a card (not a drag) selects it and opens the panel. The
  selected card is at full strength with the accent ring; the others stay dimmed as today.
- **Where**: beside the card, 12 px away, on the right when there is room and on the left otherwise,
  kept inside the window. It never covers the selected card.
- **Moving**: drag it by its header (the grip). It stays where it was put until the editor is left;
  after a drag, selecting another card does not move it again.
- **No scrim, not modal**: the dashboard under it stays live and can be scrolled; clicking another card
  switches the panel to that card; Escape or the close button closes it and gives focus back to the card.
- **Live**: every field writes to the draft (`draft.change`), so the card redraws at once. Nothing is
  saved until Done; Cancel discards. The thin line under the header says so: "The card changes as you
  type · kept with Done".
- **Width** 340 px. Under 640 px of window width it becomes a bottom sheet of half the height, with
  the selected card scrolled into view above it (not drawn on a board).
- Do not reuse the package `Floating` window: it is tied to a package and has throw physics. A pointer
  drag with clamping is enough.

Fields, top to bottom:

| Card                                      | Fields                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Entity card (`N-Dashboard-Card-Settings`) | Entity · Name and icon (the platform's icon button and popover) · Size · Show · When tapped · Place in           |
| Together (`…-Together`)                   | Members (By rule / By hand) · Where · Leave out · "6 lights match now" · Name and icon · Size · Place in         |
| Package card (`…-Package`)                | A framed block "Asked by the package" with the manifest `options` drawn by `SetupForm` · Title · Size · Place in |
| Others                                    | What the inspector has today, plus Size and Place in                                                             |

Foot: Remove (danger) on the left, Duplicate on the right.

**(proposed)** two new options, stored on the card:

- **Show**: switches for the parts a size can do without ("Colour presets", "Brightness slider",
  chart, trend…). Each card kind declares the list for each size. Store the hidden ones:
  `hide?: string[]`.
- **When tapped**: "Open the light" (the entity sheet, default), "Turn on or off", "Nothing". Only the
  choices the entity supports. Store `tap?: 'sheet' | 'toggle' | 'none'`.

Size is a segmented control with the sizes on offer only; the cells of the current one are shown at
the right of the label.

---

## 9. Smaller screens while editing — boards `N-Dashboard-Edit-Tablet`, `N-Dashboard-Edit-Phone`

Asked: see how the dashboard behaves on smaller screens while editing it.

- The editing bar gains a three-way switch: **Desktop · Tablet · Phone**.
- Tablet and Phone put the grid inside a frame of that width (768 and 390 px), centred on the dotted
  floor, with the width and the number of columns written above it. The two edges of the frame can be
  dragged for any width; the label follows.
- It is a preview: cards cannot be moved or resized there, Add card and Add group are hidden, and the
  hint says so. Card settings still open, so a size can be changed while looking at the phone.
- The frame is the window of that device: inside it the page keeps its gutter (24 px at tablet, 16 px
  at phone). The navigation is not drawn.

How to build it: wrap the grid in a box of the chosen width. The grid already measures its own width
with a `ResizeObserver` and draws `narrowLayout` when narrow, so the preview is the real thing, not a
copy. In preview, skip the "Widen the window…" message and keep editing locked instead.

**(proposed)** the column rule changes, because today's gives columns of about 170 px at tablet and at
phone width, too narrow for a card designed at 267 px:

| Grid width      | Today     | Proposed     |
| --------------- | --------- | ------------ |
| 900 px and more | 4 columns | 4 columns    |
| 720 to 899 px   | 4 columns | 2 columns    |
| 480 to 719 px   | 2 columns | 2 columns    |
| under 480 px    | 2 columns | **1 column** |

So no column is narrower than about 210 px. This is `NARROW_WIDTH_PX` becoming two thresholds and
`narrowLayout(layout, columns, sizesOf)` accepting 1.

Rule for one column, stated once: a card keeps its height; a two-column size takes the one-column size
of the same height when its kind has one (Strip to Tile, Square to Card); a kind with no one-column
size (media player, camera, energy, package cards) keeps its size and is drawn in the single column,
so those cards must hold at 320 px. The phone board shows the media Square laid out for that width.
Groups take the full width and reflow their own cards the same way.

The stored layout stays one, for four columns. There is no layout per breakpoint and nothing is
written when previewing.

---

## 10. Open choices

Confirm with the owner before, or build so they are one constant away:

1. Members by rule as the default (6.1).
2. A control stays when at least one member supports it, with "3 of 4" (6.1).
3. Locks together offer only "Lock all" (6.1).
4. Thermostats together move every target by the same step (6.1).
5. "No answer" after 10 s, message gone after a minute (4).
6. "Add and choose another" in place of adding several entities at once (7.2).
7. The new card options Show and When tapped (8).
8. Columns: 4 from 900 px, 2 from 480 px, 1 below (9).
9. The field names of the new card types (5, 6).

Not designed: the light theme, the settings bottom sheet on a phone, Add group (unchanged), the list a
Summary opens, the full-screen map of a Person.

---

## 11. Order to build in

Each step can ship alone.

1. Size names (2) and `allowedSizes` with the capability rule on the existing cards (3).
2. The six shared states in the card frame (4).
3. The floating settings panel, with today's fields (8), then Show and When tapped.
4. `CardPreview` and the new Add card dialog for the existing kinds (7), then `isPreview` in the SDK
   for package cards.
5. The width switch and the column rule (9).
6. The new entity kinds: Fan, Time · Date, Person, Bars (5).
7. Together, then Summary and Room, which reuse it (6).
8. Compare, Activity, Automation, Note, Shortcut, Entity list, Quick actions (5, 6.4).

Contracts first for every step that adds a card type: `packages/contracts/src/api-dashboards.ts`, then
rebuild contracts before the web-ui sees the new export.
