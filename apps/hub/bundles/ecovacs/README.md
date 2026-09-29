# ecovacs

ECOVACS **GOAT** robot mowers and **DEEBOT** robot vacuums, through the ECOVACS HOME account
they are bound to - the way the app reaches them. Neither has a local API: everything goes
through ECOVACS's servers, so the vendor needs the internet (`internetRequired`).

The protocol is the app's, and none of it is a documented API. The GOATs' is as the community's
[ecovacs-goat-g1](https://github.com/Janverhu/ecovacs-goat-g1) integration for Home Assistant
(MIT) observed it; the DEEBOTs' - their commands, their map - as the
[DeebotUniverse client library](https://github.com/DeebotUniverse/client.py) (GPL-3.0) observed
it. Only the facts are used - command names, fields, what they mean - re-expressed here; no code
of either is copied.

## What runs where

```
ECOVACS HOME account ── sign-in, device list, commands (HTTPS) ──> ecovacs/cloud (hub)
        │                                                              ^
        └── mq-<eu|ww>.ecouser.net:443 (MQTT over TLS) ── pushes ──────┘
```

`cloud/transport.js` is one connection per account, shared by every robot on it. It opens the
account's MQTT session on ECOVACS's broker with the credentials the account keeps, reads each
robot whole when it is first followed (grouped `getInfo` reads, as the app asks), folds every push
(`iot/atr/<what>/<did>/<class>/<resource>/j`) into one state and hands the whole state to the
robot's device whenever it changes. It reads a robot again a few seconds after a push that says
something moved, before a command when what it knows is older than five minutes, and every half
hour besides. A vacuum's map is read when it is first followed, when the robot says it changed,
and every half hour; while the vacuum cleans or goes back, where it is and the path it took are
asked every thirty seconds, beside what it pushes.

| File                 | What                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| `account.json`       | The account: email, password, country; its card is named by the email                  |
| `cloud/sign-in.js`   | Signing in, step by step: the password, then the code ECOVACS emails the first time    |
| `cloud/account.js`   | One connected account, shared by the transport and the listener: its session, renewed  |
| `cloud/api.js`       | The app's calls: signing, sign-in, email confirmation, device list, control tokens     |
| `cloud/models.js`    | Which robot a product name is - a GOAT or a DEEBOT, which model - and its dialect      |
| `cloud/mower.js`     | A mower's state from its reports, in m², s and %; settings and acts as the app sends   |
| `cloud/vacuum.js`    | A vacuum's state and its map's data; cleaning, rooms and settings as the app sends     |
| `cloud/map.js`       | A vacuum's map, unpacked and drawn: floor plan, rooms, path, robot and station, as SVG |
| `cloud/transport.js` | `ecovacs/cloud`                                                                        |
| `cloud/discovery.js` | Finds the robots on every account connected (`context.accounts`)                       |

## Connecting the account

The vendor's page has an **Account** card: **Add account** asks for the ECOVACS HOME account's
**email**, its **password** (sealed; only its MD5 digest is sent, which is the app's wire format)
and the **country** it was made in, which decides the data centre (Europe, or the rest of the
world; China has its own). A house with two accounts adds both.

**The code.** The first time NebulaHome signs in, ECOVACS refuses until the client is confirmed
with a code it emails to the account. The card asks for it at once - _ECOVACS wants to confirm
NebulaHome's sign-in: it emailed a code to ow…@example.com_ - and the email is asked for at most
once a quarter of an hour, however often the owner tries. A code ECOVACS does not take is said
so, and asked for again. The client is eight characters derived from the email, so it is the
same client after every restart, and the password alone is enough from then on.

**The session.** What the sign-in gives - ECOVACS's session and the portal's credentials made
from it - is kept with the account, sealed. A restart goes straight to the robots; when the
credentials run out, after about a week, the session is rotated and new ones asked for, and kept
again. Only when ECOVACS wants the owner - the password was changed, or it asks for a code again

- does the card say **Needs signing in again**; the account's robots stop until then. Nothing
  asks ECOVACS to email a code without the owner starting a sign-in.

## Adding the devices

Nothing is added by hand (`"adopt": "automatic"` in `discovery.json`): once an account is
connected, the listener adds **each GOAT** (product category `GOATBOT`) and **each DEEBOT**
(`DEEBOT`) on it, named as in the app. A device remembers the account it is on and its robot
(`account`, `did`). A robot of another kind - an AIRBOT air purifier, a WINBOT window cleaner - is
listed under **Seen but not added**, with why.

Each account is asked again every ten minutes, so a robot bound in the app appears on its own,
and at once when the account is connected.

## Models

One driver for every GOAT, `mower`, and one for every DEEBOT, `vacuum`: the entities are the same
across a line, and what differs is the dialect the commands are in, which the transport picks
from the product name.

| Model                                                           | Dialect                           | Status                                                    |
| --------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| GOAT G1, G1-800, G1-1600, G1-2000                               | G1: `clean_V2`, `getCleanInfo_V2` | Validated on a G1-800 by ecovacs-goat-g1                  |
| GOAT O800 RTK                                                   | O series: `clean`, `getCleanInfo` | Confirmed from a capture by ecovacs-goat-g1; experimental |
| GOAT O500 Panorama, O1000 LiDAR Pro, O1200 RTK, O1200 LiDAR Pro | O series                          | Same generation as the O800; experimental                 |
| GOAT A1600 RTK, A2000 LiDAR Pro, A3000 LiDAR, A3000 LiDAR Pro   | O series (believed)               | Unconfirmed                                               |
| GOAT GX-600                                                     | G1 (believed)                     | Unconfirmed                                               |
| Another GOAT                                                    | from its name                     | Unconfirmed                                               |
| DEEBOT X5, X2, X1 OMNI; T30, T20 OMNI; T10, T9, OZMO T8         | V2: `clean_V2` with a `content`   | From DeebotUniverse's facts; unverified here              |
| DEEBOT N20, N10, N8                                             | V2                                | Unverified                                                |
| DEEBOT OZMO 950, 920, 900                                       | V1: `clean` with a type           | Unverified                                                |
| Another DEEBOT                                                  | V2                                | Unverified                                                |

A robot that answers a command with code 20003 (`rcp not support`) does not know it: cleaning or
mowing is then sent in the other dialect, which is kept for the rest of the connection, and a
read it refuses is not asked of it again. A wrong guess costs one refused request.

## What a mower becomes

| Entity                                                                             | Domain         | What                                                                                            |
| ---------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| Mower                                                                              | `lawn_mower`   | Mowing, paused, going back, in its station, idle, fault; start, pause, end job, back to station |
| Battery, Charging                                                                  | sensor, binary | Percent; whether it charges                                                                     |
| Fault, Fault reported                                                              | binary, sensor | Whether it reports a fault, and which (`No fault` for none)                                     |
| Area mowed, Area of the job, Job progress, Mowing time                             | sensor         | The job in progress: m², m², %, s                                                               |
| Total area mowed, Total mowing time, Mowings                                       | sensor         | Everything it ever did (`total_increasing`)                                                     |
| Blade life left, Camera brush life left                                            | sensor         | Percent left of each consumable                                                                 |
| Wi-Fi signal, Wi-Fi network, IP address                                            | sensor         | dBm, SSID, address                                                                              |
| Stop for rain, Wait after rain                                                     | switch, number | The rain sensor, and minutes to wait after rain (0 to 1440)                                     |
| Animal protection, … from, … until                                                 | switch, select | Staying in at night for animals, and the window, by the half hour                               |
| AI obstacle recognition, Edge mowing, Safer mode, Lift warning, Map border warning | switch         | The app's switches                                                                              |
| Cutting direction                                                                  | number         | The angle of its lines, 0° to 180° - set only while it is in its station or idle                |
| Mowing efficiency, Obstacle avoidance                                              | select         | Quick or delicate; short grass, general, or bumpy ground with tall grass                        |

A setting that is one of a pair - the rain sensor and its delay, animal protection and its window -
is sent with the other half as it stands, and every write during a job carries the job's id
(`bdTaskID`), as the app's do. What a write sets is shown at once; the mower's own report
confirms it.

## What a vacuum becomes

| Entity                                                       | Domain         | What                                                                                                      |
| ------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------- |
| Vacuum                                                       | `vacuum`       | Cleaning, paused, going back, docked, idle, fault; start or resume, pause, end, dock, locate, clean rooms |
| Map                                                          | `image`        | The live map, below                                                                                       |
| Battery, Charging                                            | sensor, binary | Percent; whether it charges                                                                               |
| Fault, Fault reported                                        | binary, sensor | Whether it reports a fault, and which                                                                     |
| Area cleaned, Cleaning time                                  | sensor         | The job: m², s                                                                                            |
| Total area cleaned, Total cleaning time, Total cleanings     | sensor         | Everything it ever did (`total_increasing`)                                                               |
| Main brush life left, Side brush life left, Filter life left | sensor         | Percent left of each consumable                                                                           |
| Suction, Water flow                                          | select         | Quiet, standard, max, max+; low, medium, high, very high                                                  |
| Passes, Volume                                               | number         | Once or twice over each room; the voice, 0 to 10                                                          |
| Resume after charging, Carpet boost                          | switch         | Carrying on a job after a charge; more suction on carpet                                                  |
| Wi-Fi signal, Wi-Fi network, IP address                      | sensor         | dBm, SSID, address                                                                                        |

**Clean rooms** picks from the rooms of the map in use, by the names the app gave them - or the
kind of room they are, for one without - and sends them as a spot-area job.

## The map

`cloud/map.js` draws one SVG a vacuum, which its **Map** entity shows (the platform's `image`
entity; the hub keeps the picture and announces a new one at most every five seconds):

- **the floor plan**: 64 pieces of 100 × 100 cells of 50 mm - nothing, floor, wall, carpet - each
  named by a CRC (`getMajorMap`) and sent packed with LZMA (`getMinorMap`). Only a piece whose CRC
  changed is asked for again. The pieces become one PNG of four colours, cropped to what the robot
  saw, set in the SVG;
- **the rooms** (`getMapSet`, `getMapSubSet`), outlined and named;
- **the path** of the job (`getMapTrace`, `onMapTrace`), the last 20 000 points;
- **the robot**, with where it faces, and **its station** (`getPos`, `onPos`).

It is drawn again only when one of those changed, and the floor plan's PNG only when a piece did.

## Not shipped

- **The GOATs' map** - position, trace, the lawn's outline, UWB beacons or the RTK base.
- **Firmware** (`getOta`): the reply's shape is not known.
- **Schedules**, **zones**, **no-go lines**, and editing a map.
- A DEEBOT's **station** functions - emptying, washing and drying the mop - and its **camera**.

## What is unverified

Written against the two projects' observations and tested against a fake of ECOVACS's servers
and broker. It has not run against a real account or a real robot: the first real sign-in - and
its emailed code - is the check. Of the DEEBOTs, all is unverified here, and the map's orientation
most of all: cells are laid down the columns, and millimetres grow up the map while cells grow
down the picture. If a real map comes out mirrored or turned, `cellOf` and the piece layout in
`cloud/map.js` are where it is put right. The GOATs' A series and the GX-600 dialects are guesses
the fallback covers.
