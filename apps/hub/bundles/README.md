# Bundles under development

The product ships with no integration: a production hub reads only the data directory's
`hub/integrations`, where a download from the integrations catalogue will land. Until that
catalogue exists, the bundles written in this repository live here, and outside production the
hub reads this directory beside the data directory - `HUB_DEV_BUNDLE_DIR` defaults to it - so
anything here is loaded at startup without anybody installing it. A bundle with the same id in
`hub/integrations` replaces the one here, and the log says so. A production image does not
contain this directory.

Loaded means present and offering to connect to devices; nothing is connected until somebody
adds one. Adding one is the whole of it: a device added from the vendor's page is an instance of its
driver and a row in the registry under one id, and the hub identifies the hardware behind it
by itself. A vendor with a `discovery.json` is also **found**: the hub listens for its devices
announcing themselves and the integrations page offers each one it hears to adopt - which is
adding it, with the driver, the model and the address already filled in. Nothing is added
until the owner says so.

A bundle is a **vendor directory** holding one **driver directory** per profile or entry point:

```
shelly/
├── manifest.json       who the vendor is                            ← always
├── logo.svg            the mark the interface shows (.svg or .png)  ← optional
├── setup.json          what every device of the vendor shares       ← optional
├── discovery.json      how its devices are found unasked            ← optional
├── README.md           what the devices are, what is unverified     ← always
├── rpc/transport.js    a transport of the vendor's own              ← optional
└── dimmer-pm/
    ├── driver.json     transport, models, which file holds it       ← always
    ├── setup.json      what adding one device asks                  ← always
    └── profile.json    the declarative mapping (or index.js, code)  ← one of the two
```

The directory names are the ids: `shelly` must say `"id": "shelly"` in its manifest and
`dimmer-pm` must say `"id": "dimmer-pm"` in its driver file, or the loader refuses the directory
and says which two names disagree. Together they make the driver's **kind**, `shelly/dimmer-pm`,
which is what a device row references.

`manifest.json` says who the vendor is. Which transports a vendor speaks is derived from its
drivers, so it cannot be declared wrongly; what the manifest may add is a transport the vendor
**ships** - see below:

```json
{
  "id": "shelly",
  "version": "2.1.0",
  "sdk": "^1.0.0",
  "name": "Shelly",
  "description": "Shelly Gen3 and Gen4 devices on your own network, each spoken to directly over its RPC interface.",
  "url": "https://shelly.com",
  "color": "#3B9DFF",
  "logo": { "path": "./logo.svg", "padding": 4 },
  "internetRequired": false,
  "transports": { "rpc": "./rpc/transport.js" }
}
```

`logo` is a path relative to the bundle, either bare - `"logo": "./logo.svg"` - or, as above,
with `padding` (0 to 16, default 0): extra room, in pixels, the interface leaves around the logo
inside its tile. Every logo already gets a small margin; this is on top of it, for a mark drawn
to the very edge of its file. It cannot ask for less than the margin, only for more.

`driver.json` says how one profile is loaded and **which models it drives**. The list is what the
owner picks from when adding a device: Bambu Lab's one `printer` driver lists six printers, so the
form offers six choices and the row remembers the one picked, though all six run the same
profile. A driver that lists no model offers its own name. Strict, and without the vendor's
fields on purpose - a driver repeating the vendor's name would be a second copy to keep in step:

```json
{
  "id": "dimmer-pm",
  "name": "Dimmer with power metering",
  "transport": "shelly/rpc",
  "models": ["Dimmer 0/1-10V PM Gen3", "Dimmer 0/1-10V PM Gen4", "Dimmer Gen3", "Dimmer Gen4"],
  "modelCodes": {
    "S3DM-0010WW": "Dimmer 0/1-10V PM Gen3",
    "S4DM-0010WW": "Dimmer 0/1-10V PM Gen4",
    "S3DM-0A101WWL": "Dimmer Gen3",
    "S4DM-0A101WWL": "Dimmer Gen4"
  },
  "defaultIcon": "light",
  "webPagePort": 80,
  "kind": "declarative",
  "profile": "./profile.json",
  "setup": "./setup.json"
}
```

`webPagePort` says the device serves a web page of its own, and on which port: a device of a
driver that names one gets a **Web page** link in the header of its page, to
`http://<host>:<port><webPagePath>`. `webPagePath` is optional and starts with `/` - Plex Web is at
`/web`. When the address the owner typed carries a port, that port wins: the device answers the
platform and the browser from the same server. A driver whose devices have no page to look at -
an API port answering JSON, a UDP protocol - names no port and gets no link.

`modelCodes` maps what the hardware calls itself onto the model on the box, and it is how
discovery knows which driver a device it heard belongs to and which model to adopt it as. A code
may name a list when the hardware says its family but not which of it it is - a Sonoff in DIY mode
announces `diy_plug` whether it is a BASICR3 or a MINI - and the owner then picks among those.
Every model named must be in `models`, and a driver that lists none maps no codes.

`transport` is a platform transport - `http`, `mqtt` - or one the driver's own vendor ships,
named after the vendor: `shelly/rpc`. Never another vendor's: vendors load in no particular
order, and a driver leaning on another's transport would load or not by luck.

`defaultIcon` names the icon a device of this driver starts with, by its id in the platform's
icon catalogue (`packages/icons/catalogue.json` lists the platform's own ids - `light`,
`relay`, `printer`, `sensor`… - and every lucide icon is there under its own name). The owner
may pick another per device. The hub does not check the id; the API does when a device is
added, and falls back to no icon with a warning rather than refusing the device, so a typo in
somebody's bundle costs a blank tile and not the device. `shipped-bundles.test.ts` does check
the two here.

Each entity in `profile.json` may name its own `icon` the same way - `"icon": "thermometer"` on
a temperature sensor - and it is the bundle's first word only: the owner may rename an entity
or pick another icon from the devices page, and identifying the hardware again does not put the
bundle's back. An entity that names none shows a blank tile until the owner picks one.
`shipped-bundles.test.ts` checks every entity icon the two bundles here name.

The format is `packages/package-runtime` and the ceiling it enforces is deliberate: every object
is strict and every expression is a path, so a profile cannot become a program one feature at a
time. A device whose entities are not known in advance needs a code driver instead. Two forms go
as far as the ceiling allows, and no further: a claim may ask that a path be **one of** a list of
values - `{ "path": "model", "oneOf": ["S3DM-0010WW", "S4DM-0010WW"] }`, which is how one driver
serves a family of models - and a state may be **looked up in a table** -
`{ "path": "'cover:0'.state", "map": { "opening": "opening" }, "default": "stopped" }`, which
renames what a device says into what a capability accepts. A list is membership, not an `or`
between paths; a table renames and cannot compute.

A third form reads whether something is **there** -
`{ "path": "sys.available_updates.stable", "present": true }` - true when the path names a value,
false when the object that would hold it is there without it. It is the one read that turns an
absence into an answer, and only where the report carries the holder: a report without `sys` at
all still says nothing. It is how a firmware update is read - Shelly lists the update it offers
under `available_updates`, and empties it once the update is installed.

An entity with the **`button`** capability (domain `button`) holds no state: it is reported, empty,
on anything its device says, so it is available exactly when the device is, and its one command is
`button.press`. A profile gives it `"state": {}` and the request pressing it sends. With
`"deviceClass": "update"` or `"restart"` the interface asks before pressing, since the device goes
away for a while.

### Firmware updates

A driver whose devices say when an update is waiting, and install one when asked, exposes two
entities: a `binary_sensor` with `"deviceClass": "update"` that is on while an update is offered,
and a `button` with `"deviceClass": "update"` that installs it. The Shelly drivers do: the sensor
reads `sys.available_updates.stable` with `present`, the button calls `Shelly.Update` with
`{ "stage": "stable" }`. The device checks for updates itself, over the internet; one that cannot
reach the internet never offers one. A vendor that can say an update is waiting but not install it
exposes the sensor alone; one that can do neither exposes nothing.

The logo rides inside the catalogue the hub serves, as a data URL, so it must be an `.svg` or a
`.png` and at most 64 KiB; anything else fails the vendor at startup. The two that ship are
monograms in the vendor's colour - nobody's trademark - and the interface draws the same
monogram itself for a vendor that ships no logo at all.

## `discovery.json` - how the devices are found

A vendor whose devices announce themselves says how in `discovery.json`, and the hub does the same
six steps for every vendor that has one: **listen**, **match**, **probe**, **identify**, then the
two that are the hub's - **associate** the model with a driver through its `modelCodes`, and
**propose** the device on the integrations page. No address is swept and no port scanned: the
hub hears announcements, asks the question the protocol exists for, and probes an address only
because a device announced it there.

```json
{
  "listen": [{ "mdns": "_shelly._tcp" }],
  "probe": {
    "transport": "shelly/rpc",
    "op": "call",
    "args": { "method": "Shelly.GetDeviceInfo" }
  },
  "identity": { "externalId": "id", "name": "name", "model": "model", "swVersion": "ver" }
}
```

- `listen` - up to four sources: `{ "mdns": "_name._tcp" }`, a service the platform browses for,
  or `{ "module": "./lan/discovery.js" }`, a listener of the vendor's own (below). An mDNS
  announcement is read as `{ service, instance, host, address, port, txt: { … } }`, and the device
  is reached at `address`, with `:port` when it is not 80.
- `match` - conditions in the claim's grammar, all of which must hold of the announcement: for a
  service other vendors announce too.
- `probe` - optional: a request, in a transport's words - the vendor's own or a platform one -
  asked of the announced address with the vendor's saved settings beneath it. Its answer is what
  `identity` reads, and it should be the same question the drivers' `discovery.probe` asks, so the
  id discovery finds is the id identification then insists on. Without one, `identity` reads the
  announcement, and must then say where the model is: without a probe the drivers' own claims have
  nothing to read.
- `identity` - paths to the model code, the id, the name and the firmware version. Only the model
  is ever required.

The hub asks mDNS when it starts - three times over the first seconds, since one question over
multicast can be lost - and again every `HUB_DISCOVERY_QUERY_INTERVAL_MS`; an address that did not
answer its probe is asked again after thirty seconds rather than at the next interval, and an
address already added is not probed at all. An owner can have it look **now**: **Scan network** on
the integrations page asks every vendor that can be found, and **Discover devices** on a vendor's
page asks that vendor (`POST /api/v1/discovery/scan`, the hub's `discover` method). A vendor with
no `discovery.json` offers neither, and its devices are added by address. What is found is shown on
the vendor's own page, above its devices.

The model code is looked up in every driver's `modelCodes`; when no driver maps it, the drivers'
own claims decide, in load order, on what the probe returned. Two drivers may map one code only
when the vendor probes - a Shelly 2PM reports one code as relays or as a cover, and each driver's
claim reads its profile. A device no driver takes is not proposed, and the hub logs its model at
debug. A `discovery.json` that does not load leaves the vendor loaded without discovery, and the
failure names the file.

**A listener of the vendor's own** is a module - plain JavaScript, like a transport, handed the
same SDK - whose default export returns `{ listen(signal), scan?() }`: an async iterable of
sightings, `{ config: { host }, payload }`, reported as they happen until the signal ends it, and,
optionally, a way to ask the network again now, which the owner's scan calls - its answers arrive
through `listen` like every other. It listens and reports; which driver a device belongs to stays
the business of `discovery.json`. A sighting at a public address is not followed.

## `setup.json` - what adding a device asks

`driver.json` says what a driver is and `profile.json` says how it maps a device; the driver's
`setup.json` says what the form asks when an owner adds a device by hand. The interface builds
the form from it, the API checks what was typed against it, and the hub never reads it for
anything else - so a driver that needs a new field adds a line here and nothing else changes.

A **vendor** may ship a `setup.json` of its own, in exactly the same grammar, for what every
device of theirs shares - a cloud API key, an account. Neither vendor here does. When one does,
the interface asks for it once, from the vendor's page, and refuses to add a device until it has
been given; the hub then puts the vendor's answers under every instance it starts, lowest first:
the vendor's settings, then the driver's constants, then what the owner typed for that device.
A vendor-level field must therefore be a key the transport understands, the same as a
driver-level one.

```json
{
  "transport": {
    "constants": { "username": "bblp", "shouldVerifyCertificate": false },
    "fields": [
      {
        "key": "url",
        "type": "text",
        "label": "Printer address",
        "isRequired": true,
        "placeholder": "mqtts://192.168.1.60:8883",
        "pattern": "^mqtts://[^/ ]+$",
        "patternMessage": "Must start with mqtts://, the printer only speaks TLS.",
        "help": "The printer's LAN address on port 8883."
      },
      {
        "key": "password",
        "type": "secret",
        "label": "Access code",
        "isRequired": true,
        "minLength": 8,
        "maxLength": 8
      }
    ]
  },
  "options": { "fields": [] }
}
```

Two groups, one per column of `registry.integrations` (or of `registry.integration_vendors`,
for a vendor's own): `transport` becomes `transport_config`, the settings the transport opens a
connection with, and `options` becomes `options`, whatever the integration itself takes (it may
be left out). Each group has:

- `constants` - values the bundle fixes and the form never shows. They are written into the row
  by the API beside what the owner typed, and refused if a client sends them: a printer that only
  ever logs in as `bblp` says so here, and nobody can turn certificate checking back on for it.
- `fields` - what the form asks, in this order. Every field has a `key` (a camelCase
  identifier, the JSON key it is stored under), a `label`, an optional `help` line and
  `isRequired`. The `type` decides the control and the checks:

  | Type      | Control              | Checks                                                                                |
  | --------- | -------------------- | ------------------------------------------------------------------------------------- |
  | `text`    | text field           | `minLength`, `maxLength` (512), `pattern`, `patternMessage`, `default`, `placeholder` |
  | `secret`  | password field       | as `text`; **sealed** before it is stored, never served back                          |
  | `number`  | number field         | `min`, `max`, `isInteger`, `unit`, `default`                                          |
  | `boolean` | on/off switch        | `default`                                                                             |
  | `choice`  | select               | `choices: [{ value, label }]`, `default`                                              |
  | `list`    | comma-separated text | `minItems`, `maxItems` (64), `pattern` and `patternMessage` per item                  |

A `secret` value is encrypted with `NEBULA_SECRETS_KEY` by the API before it reaches the
database and decrypted by the hub when the instance starts; the interface only ever learns that
one is kept. A `pattern` is a regular expression source and must compile, or the bundle fails to
load - which is the point: a typo here is found at startup rather than on somebody's form. Give
it a `patternMessage` whenever the pattern encodes a fact about the device: the form shows that
sentence under the field, where the pattern itself would tell a person nothing.

**Test** in the interface opens the bundle's transport once with what was typed and closes it
again, keeping nothing: for MQTT that is one session, for HTTP one request to the address. The
verdict is a sentence in the transport's own words, so `Not authorized` and `ECONNREFUSED` send
an owner to different places. When the vendor's `discovery.json` probes, the Test asks the device
that question too, and the form preselects the model it says it is.

**What the `http` transport takes.** A request template's `op` is the verb - `get`, `post`,
`put`, `patch`, `delete` - with `path`, `query` and a `body` sent as JSON; a `poll` names its verb
in `method`. Beyond `host`, `isSecure`, `timeoutMs` and basic auth (`username`, `password`), the
transport configuration takes what a setup fills and the profile never sees: a `token` (a secret
field), sent in the header `tokenHeader` names (with `tokenPrefix` in front, `Bearer ` for one) or
put into the path by `pathPrefix`, where `{token}` stands for it - `/api/v1/{token}` - and
`shouldVerifyCertificate: false` for a device that signs its own certificate. The bundle fixes
the header, the prefix and the certificate check as constants; the owner types the token.

**Save** creates the device and starts it. The hub has no claim for a device it has never heard
from, so it reports the instance `identifying` and listens with the driver's `discovery` -
the MQTT subscription, the probe of the address - until the driver claims what answers; then it
asks `core` to complete the device's row with the serial, the claim and the entities, and the
instance is `running`. The claim stays on the row, so the next start binds the device without
listening again. A device that stays `identifying` is one the hub cannot hear, or one no driver
claims: the hub logs what answered and what it said of itself, and each bundle below says what
to look at.

## A transport of the vendor's own

A vendor whose devices speak a protocol the hub does not may ship the transport itself. The
manifest names it - `"transports": { "rpc": "./rpc/transport.js" }` - and the hub loads the
module when it loads the vendor, before the drivers, and registers what it builds as
`<vendor>/<name>`: `shelly/rpc`. Its drivers then say `"transport": "shelly/rpc"`, and nothing
else about them changes: they stay declarative, and the profile's requests are in the new
transport's own words.

The module is plain JavaScript - an installed bundle is loaded as it is, with no build step - and
its default export is a function the hub calls with the **SDK**, the runtime's pieces a transport
needs, since the bundle cannot import them:

| `sdk.`            | What                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `version`         | the runtime version, the one `manifest.sdk` was matched against                    |
| `z`               | the runtime's zod, so the transport's settings validate as the hub's do            |
| `defineTransport` | the contract the platform's own transports are written against                     |
| `openWebSocket`   | a WebSocket the hub keeps open: reconnection with a doubling pause, resets         |
| `openUdpSocket`   | a UDP socket the hub binds, joins to a multicast group, and closes with the vendor |
| `logger`          | the hub's logger, for what happens outside a connection                            |

The transport it returns is the one the platform's `http` and `mqtt` are:
`connectionKey`, `connect`, `scan`, `probe`, and a `configSchema` for what the driver's
`setup.json` asks. Its `id` must be `<vendor>/<name>`, or the loader refuses the vendor naming
both. It is **code**, so the vendor sits at the tier a code driver does - reviewed before a
catalogue carries it; `verifyVendor` is where the hub asks. The hub type-checks the ones that
ship here (`checkJs`), so write the types in JSDoc and start the file with `// @ts-check`.

## shelly

Fifteen drivers, one per layout of components, for the Shelly **Gen3 and Gen4** range: relays,
plugs, dimmers, covers, energy meters and input boxes, each driver listing the models it drives.
All of them run on the bundle's own transport, `shelly/rpc`: Shelly's JSON-RPC over the WebSocket
every device serves, with the status pushed as it changes and the digest authentication the
devices ask for. A driver claims a device by its hardware `model` code, one of a list.

Every driver links to the device's own web page on port 80, and exposes a **firmware update**
sensor and an **install** button (see _Firmware updates_ above).

Its own README says what the devices are, how the transport treats them, which models each
family takes, and what has not been checked against hardware - above all the model codes, and
the one-line fix when a device on the network is not claimed.

## sonoff

One driver, `diy-plug`, for Sonoff relays in **DIY mode** - BASICR3, RFR3, MINI, MINIR2 - over
the HTTP API the firmware serves on port 8081: every request a POST with a JSON body. Found over
mDNS (`_ewelink._tcp`), from the TXT record alone: it says the device's id and that it is a
`diy_plug`, which names the driver but not which of the four it is, so the owner picks.

## plex

One driver, `server`: a Plex Media Server and how many streams it is playing, polled from the
server with the owner's `X-Plex-Token`, which the transport sends in that header. Not discoverable:
Plex announces itself with a protocol of its own (GDM), not over mDNS; it is added by address.
Links to Plex Web (`:32400/web`). No firmware entities yet: the server says an update is waiting at
`/updater/status`, but a declarative profile reads every poll into every entity, and that answer
carries a `MediaContainer.size` of its own that would overwrite the activity count.

## nanoleaf

One driver, `panels`, for the controllers of the OpenAPI - Light Panels, Canvas, Shapes, Elements,
Lines - on port 16021, with the token in the path (`/api/v1/<token>/…`) and the state written as
a PUT. Found over mDNS (`_nanoleafapi._tcp`), the model read from the TXT record: the controller
tells nothing to a caller without its token, so adopting one asks for it. No firmware entities:
the OpenAPI reports the version and offers no update over the LAN.

## govee

One driver, `light-lan`, for Govee lights with **LAN Control** switched on in the Govee app, over
the vendor's own `govee/lan` transport: JSON datagrams over UDP, a status asked and answered, and
the commands for on, off, brightness and colour temperature. Found by its own listener, which asks
the LAN API's multicast scan; the transport and the listener share the one socket every answer
comes back to. The first bundle on the SDK's UDP sockets. The listener answers the owner's scan by
sending the multicast scan at once. No firmware entities: the LAN API reports versions only.

## bambu-lab

One driver, `printer`, listing X1C, X1E, P1S, P1P, A1 and A1 mini: every one of them is a Bambu
Lab printer in LAN mode, over the MQTT broker the printer runs itself, and the profile is the
same for all six - the list is there so the owner says which they have. The chamber light,
the temperatures and the print in progress; no camera. It is the first bundle on the MQTT
transport, and the four things it needed - a self-signed certificate, the serial that lives in
the topic, topics composed from it, and a request sent on every reconnect - are in the transport
now for whatever comes next. Its own README says what the printer is and what has not been
checked against one.
