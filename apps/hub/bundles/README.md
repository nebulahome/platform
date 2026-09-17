# Bundles that ship with the hub

`HUB_BUNDLE_DIR` defaults to this directory, so anything here is loaded at startup without
anybody installing it. That is what "installed by default" means for an integration: the driver
is present and offering to connect to devices, and nothing is connected until somebody adds one.
Adding one is the whole of it: a device added from the vendor's page is an instance of its
driver and a row in the registry under one id, and the hub identifies the hardware behind it
by itself - there is no scan to start and nothing to adopt.

A bundle is a **vendor directory** holding one **driver directory** per profile or entry point:

```
shelly/
├── manifest.json       who the vendor is                            ← always
├── logo.svg            the mark the interface shows (.svg or .png)  ← optional
├── setup.json          what every device of the vendor shares       ← optional
└── 1pm-mini-g3/
    ├── driver.json     transport, models, which file holds it       ← always
    ├── setup.json      what adding one device asks                  ← always
    └── profile.json    the declarative mapping (or index.js, code)  ← one of the two
```

The directory names are the ids: `shelly` must say `"id": "shelly"` in its manifest and
`1pm-mini-g3` must say `"id": "1pm-mini-g3"` in its driver file, or the loader refuses the
directory and says which two names disagree. Together they make the driver's **kind**,
`shelly/1pm-mini-g3`, which is what a device row references.

`manifest.json` says who the vendor is and nothing about how a device is reached - which
transports a vendor speaks is derived from its drivers, so it cannot be declared wrongly:

```json
{
  "id": "shelly",
  "version": "1.0.0",
  "sdk": "^1.0.0",
  "name": "Shelly",
  "description": "Shelly relays on your own network, each spoken to directly over its RPC interface.",
  "url": "https://shelly.com",
  "color": "#3B9DFF",
  "logo": "./logo.svg",
  "logoPadding": 0,
  "internetRequired": false
}
```

`logoPadding` (0 to 16, default 0) is extra room, in pixels, the interface leaves around the
logo inside its tile. Every logo already gets a small margin; this is on top of it, for a mark
drawn to the very edge of its file. It cannot ask for less than the margin, only for more.

`driver.json` says how one profile is loaded and **which models it drives**. The list is what the
owner picks from when adding a device: Bambu Lab's one `printer` driver lists six printers, so the
form offers six choices and the row remembers the one picked, though all six run the same
profile. A driver that lists no model offers its own name. Strict, and without the vendor's
fields on purpose - a driver repeating the vendor's name would be a second copy to keep in step:

```json
{
  "id": "1pm-mini-g3",
  "name": "1PM Mini Gen3",
  "transport": "http",
  "defaultIcon": "relay",
  "kind": "declarative",
  "profile": "./profile.json",
  "setup": "./setup.json"
}
```

`defaultIcon` names the icon a device of this driver starts with, by its id in the platform's
icon catalogue (`packages/icons/catalogue.json` lists the platform's own ids - `light`,
`relay`, `printer`, `sensor`… - and every lucide icon is there under its own name). The owner
may pick another per device. The hub does not check the id; the API does when a device is
added, and falls back to no icon with a warning rather than refusing the device, so a typo in
somebody's bundle costs a blank tile and not the device. `shipped-bundles.test.ts` does check
the two here.

The format is `packages/package-runtime` and the ceiling it enforces is deliberate: every object
is strict and every expression is a path, so a profile cannot become a program one feature at a
time. A device whose entities are not known in advance needs a code driver instead.

The logo rides inside the catalogue the hub serves, as a data URL, so it must be an `.svg` or a
`.png` and at most 64 KiB; anything else fails the vendor at startup. The two that ship are
monograms in the vendor's colour - nobody's trademark - and the interface draws the same
monogram itself for a vendor that ships no logo at all.

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
an owner to different places.

**Save** creates the device and starts it. The hub has no claim for a device it has never heard
from, so it reports the instance `identifying` and listens with the driver's `discovery` -
the MQTT subscription, the HTTP probe of the address - until the driver claims what answers;
then it asks `core` to complete the device's row with the serial, the claim and the entities,
and the instance is `running`. The claim stays on the row, so the next start binds the device
without listening again. A device that stays `identifying` is one the hub cannot hear: wrong
address, printer asleep, relay of another generation - each bundle below says what to look at.

## shelly

One driver, `1pm-mini-g3`: a Shelly 1PM Mini Gen3, over its HTTP RPC. One relay and five readings — power, energy, voltage,
current, and the device's own temperature — polled from `/rpc/Shelly.GetStatus` every five
seconds.

The transport reaches a device by its address: the one `host` the owner typed when adding it.
Identification probes it with `/rpc/Shelly.GetDeviceInfo`, and this bundle claims the answer
when its `app` is `Mini1PMG3`. One device, one address, one instance - a second relay is a
second device added from the vendor's page.

**That claim is the one thing here that has not been checked against hardware.** `app` is how a
Shelly identifies its firmware application, and Gen3 Minis suffix it with `G3` — a Gen2 Mini 1PM
answers `Mini1PM` and a Plus 1PM answers `Plus1PM`. If a device on the network is not claimed,
the value it actually reports is the first thing to look at:

```
curl http://<address>/rpc/Shelly.GetDeviceInfo
```

Changing the `equals` in `profile.json` to whatever it answers is the whole fix, and a second
generation is a second driver directory under `shelly/` rather than an edit to this one: a claim
list is all-of, with no `or`, so one driver claims one kind of device.

The paths are quoted because Shelly names its status keys `switch:0`, and a colon is not a bare
identifier in the path grammar.

## bambu-lab

One driver, `printer`, listing X1C, X1E, P1S, P1P, A1 and A1 mini: every one of them is a Bambu
Lab printer in LAN mode, over the MQTT broker the printer runs itself, and the profile is the
same for all six - the list is there so the owner says which they have. The chamber light,
the temperatures and the print in progress; no camera. It is the first bundle on the MQTT
transport, and the four things it needed - a self-signed certificate, the serial that lives in
the topic, topics composed from it, and a request sent on every reconnect - are in the transport
now for whatever comes next. Its own README says what the printer is and what has not been
checked against one.
