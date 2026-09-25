# shelly

Shelly devices of every generation on the local network: **Gen2** (Plus, Pro), **Gen3** and
**Gen4** over the RPC interface each of them serves on a WebSocket at `ws://<address>/rpc`, and
**Gen1** over its HTTP API, told when to read by the CoIoT packets it multicasts. Relays, plugs,
dimmers, covers, energy meters and input boxes - twenty-eight drivers, one per layout of
components and generation of API, each listing the models it drives. Nothing goes through
Shelly's cloud, and nothing stops working when the internet does.

## Gen2, Gen3 and Gen4: RPC

A Gen2+ Shelly is a small JSON-RPC server. A request is a frame - `{ "id", "src", "method",
"params" }` - and the device answers with the same id. Once it has seen one request naming a
source, it also **pushes** a `NotifyStatus` frame whenever something changes: a relay switched
from the wall, a dimmer turned, a cover arriving at its limit. That push is why these families do
not poll: a row moves the moment the light does.

Everything the device is doing is one object, `Shelly.GetStatus`, keyed by component -
`switch:0`, `light:0`, `cover:0`, `em1:0`, `input:2`. A notification carries only what changed,
under the same keys. The profiles read the status by those keys, quoted because a colon is not a
bare name in the path grammar: `'light:0'.brightness`. Gen2 speaks the same RPC with the same
components as Gen3 and Gen4, so a Plus 1PM, a Pro 1PM and a 1PM Gen3 are one family.

The device says what it is through `Shelly.GetDeviceInfo`, which answers even with a password
set, and which `GET /shelly` answers too:

```
curl http://<address>/rpc/Shelly.GetDeviceInfo
```

```json
{
  "id": "shelly0110dimg3-8cbfea9c4a2c",
  "model": "S3DM-0010WW",
  "gen": 3,
  "ver": "1.5.0",
  "app": "Dimmer0110VPMG3",
  "auth_en": false
}
```

`id` is what makes the device the same device next time. `model` is the hardware code - the
one printed on the box and the label - and it is what the drivers claim by. `app` is the
firmware's name for itself; it has changed between releases, so nothing here depends on it. A
device with two profiles - a 2PM as relays or as a cover, a Pro 3EM as one three-phase meter or
three single-phase ones - also says `profile`.

### The transport, `shelly/rpc`

The WebSocket is not a platform transport: the hub has `http` and `mqtt`, and neither speaks
Shelly's RPC. So the bundle ships its own, `rpc/transport.js`, named in `manifest.json` and
registered by the hub as **`shelly/rpc`** when the vendor loads. It is plain JavaScript written
against the same contract as the hub's own transports, handed the runtime's pieces - zod,
`defineTransport`, a managed WebSocket that reconnects by itself - so it imports nothing from
the platform and the bundle installs on any hub whose runtime matches `sdk`.

What it does, in the order a device meets it:

- **Test**, in the add-device form, opens one socket, asks `Shelly.GetDeviceInfo` and closes
  again. With a password typed it also asks for the status, so a wrong password fails there and
  not after saving. A device with authentication on and no password typed fails with
  `asks for a password`.
- **Identification** asks the same question and hands the answer to the drivers; the one whose
  claim holds takes the device.
- **Running**, the socket stays open. The transport asks for the whole status when the socket
  opens and once a minute after - which also keeps the socket busy enough to notice a device
  that went - and lays every notification over the last status it has, attribute by attribute,
  before handing the whole object on. A profile never sees a partial report, so a cover told
  only that it is `opening` keeps its position.
- **Commands** are `call` requests: `Switch.Set`, `Light.Set` with a `brightness`,
  `Cover.GoToPosition`. The device says what a command changed before the answer even arrives;
  when no notification follows within 400 ms, the transport asks for the status, so a row never
  waits for the minute's poll. A request not answered in five seconds drops the socket, and
  it reconnects - but only a socket that said nothing at all in those five seconds: one still
  delivering notifications is alive, and dropping it would lose them.
- **Every socket names itself** in the `src` of its frames, and the device addresses its
  notifications to that name, so each socket has one of its own: `nebula-hub-<suffix>` for the
  one kept open, `nebula-probe-<suffix>` for one opened to ask a single question. With a name
  shared, a probe opened beside the kept socket - by discovery, by the Test button - took its
  notifications, and a switch pressed at the wall showed only at the next poll.
- **A drop is logged once**, at info, with the close code in words - `connection lost` for a
  socket that had opened, `connection not accepted` for one that never did - and the retries
  after it at debug. Node's WebSocket carries nothing else to say: its error event is empty.

**Authentication** is Shelly's digest, SHA-256, with the user always `admin`: a request refused
with a `401` is sent again with the answer to the challenge, and the nonce is kept for the
requests after it, its count moving on each time. A stale nonce is replaced once; a second
refusal is `refused the password`. The count goes as a number and into the hash in decimal,
which is how Home Assistant's client speaks to every firmware, the ones before 2.0 included.

### The RPC families

| Driver        | Models                                                                                                           | Entities                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `switch`      | 1, 1L, 1 Mini - Gen3 and Gen4; Plus 1, Plus 1 Mini, Plus 1 UL; Pro 1 (three revisions), Pro 1 UL                 | relay, device temperature                                   |
| `switch-pm`   | 1PM, 1PM Mini - Gen3 and Gen4; Plus 1PM, Plus 1PM Mini, Plus 1PM UL; Pro 1PM (three revisions), Pro 1PM UL       | relay, power, energy, voltage, current, device temperature  |
| `plug`        | Plug S Gen3, Outdoor Plug S Gen3, AZ Plug, Plug M Gen3, Plug US Gen4; Plus Plug S (two), IT, UK, US              | as `switch-pm`                                              |
| `switch-2`    | 2L Gen3, 2L Gen4; Pro 2 (three revisions), Pro 2 UL                                                              | two relays, device temperature                              |
| `switch-2pm`  | 2PM Gen3, 2PM Gen4, Plus 2PM (two, and UL), Pro 2PM (three revisions), in the **switch** profile                 | two relays with their readings, device temperature          |
| `cover-pm`    | the same, in the **cover** profile                                                                               | cover (position, open, close, stop, go to), its readings    |
| `switch-3`    | Pro 3                                                                                                            | three relays, device temperature                            |
| `switch-4pm`  | Pro 4PM (three revisions)                                                                                        | four relays with power, energy, voltage and current each    |
| `cover-2pm`   | Pro Dual Cover PM                                                                                                | two covers, each with its readings                          |
| `shutter`     | Shutter                                                                                                          | as `cover-pm`                                               |
| `power-strip` | PowerStrip Gen4 (two hardware revisions), PowerStrip US Gen4                                                     | four relays with power and energy each                      |
| `pm`          | PM Mini Gen3, Plug PM Gen3, Plus PM Mini                                                                         | power, voltage, current, frequency, energy, energy returned |
| `em-1`        | EM Mini Gen4                                                                                                     | as `pm`, with the power factor                              |
| `em-2`        | EM Gen3, EM Gen4, Pro EM                                                                                         | the dry contact, and the `em-1` readings for each channel   |
| `3em`         | 3EM-63 Gen3, Pro 3EM, Pro 3EM 120, Pro 3EM 3CT63, Pro 3EM-400, in the **triphase** profile                       | power, voltage and current per phase, totals, energies      |
| `dimmer`      | DALI Dimmer Gen3, Plus 0-10V Dimmer, Plus Wall Dimmer                                                            | light (on, off, brightness), device temperature             |
| `dimmer-pm`   | Dimmer 0/1-10V PM Gen3 and Gen4, Dimmer Gen3, Dimmer Gen4, Dimmer Gen4 US, Pro Dimmer 1PM, Pro Dimmer 0/1-10V PM | light, power, energy, voltage, current, device temperature  |
| `dimmer-2pm`  | Pro Dimmer 2PM                                                                                                   | two lights, each with its readings, device temperature      |
| `inputs`      | I4 Gen3, I4 Gen4, Plus I4, Plus I4DC                                                                             | four inputs, as binary sensors                              |

A driver claims a device when its `model` is one of the codes in the driver's list - the codes
come from Home Assistant's list of Shelly hardware (`aioshelly`), one per model the form offers,
in the same order. A 2PM is two devices in one box: which driver claims it depends on the profile
it is in, `switch` or `cover`, so the form offers it twice, as `2PM Gen3 (relays)` and `2PM Gen3
(cover)`. A device whose profile is changed in its web page stops being claimed by the driver it
was added with; it is removed and added again with the other.

Setting a dimmer's level switches it on at that level: a level is what the lamp shows, and a lamp
that is off shows none.

## Gen1: HTTP, and CoIoT to know when

A Gen1 Shelly has no RPC and no socket to keep open. It answers plain HTTP: `GET /shelly` for who
it is - without a login, even when one is on - `GET /status` for everything it is doing, and
`/relay/0?turn=on`, `/light/0?turn=on&brightness=40`, `/roller/0?go=to_pos&roller_pos=30` for
what it is told. A login switched on in its web page is basic authentication, with a user that
the owner may have changed from `admin`, so the form asks for both.

```json
{
  "type": "SHSW-25",
  "mac": "A4CF12F45CC4",
  "auth": true,
  "fw": "20230913-112003/v1.14.0-gcb84623",
  "num_outputs": 2,
  "num_meters": 2,
  "num_rollers": 1,
  "mode": "roller"
}
```

`mac` is what makes a Gen1 the same device next time, `type` is the hardware code the drivers
claim by, and a 2.5 says in `mode` whether it runs as two relays or as a roller - which is how
`gen1-switch-2pm` and `gen1-cover-pm` tell it apart, the way the 2PM's `profile` does over RPC.

### The transport, `shelly/gen1`

Over HTTP a device does not say when it changed. A Gen1 says so another way: whenever its state
changes, and every fifteen seconds when it does not, it multicasts a **CoIoT** packet - a CoAP
request with Shelly's code 0.30, on `/cit/s` - to 224.0.1.187, port 5683. `gen1/coiot.js` holds
one UDP socket in that group for the whole vendor, through the SDK, and `gen1/transport.js`
(registered as **`shelly/gen1`**) takes a packet from the device it drives as the signal to read
`/status` at once.

- **Which device** - by the address the packet came from (the host typed, resolved when it is a
  name), or by the device id in the packet, whose last six hex digits are the MAC's.
- **Only on a change** - the packet carries a serial the device moves on at every change; the
  periodic packet repeats the last one and costs nothing. Packets arriving together are one read,
  a quarter of a second later.
- **On connect** the status is read at once, so the rows have something to show and the hub hears
  whether the device answers.
- **After a command** the status is read again straight away: the device's answer is the channel
  the command changed, not the power it now draws.
- **The poll** - `/status` every 30 seconds, the owner's to change on the device's form (never
  under 5, a warning under 10) - is the safety net for what CoIoT loses: a packet dropped, a device
  on another subnet the multicast does not cross, CoIoT switched off in the device, or port 5683
  taken on the hub. In each of those the device still works, at the poll's pace.
- **Test** asks `/shelly`: a device with a login on and no password typed fails with
  `asks for a username and password`, and with a password typed `/status` is asked too, so a wrong
  one fails with `refused the username or password` before saving. A later Shelly at that address
  is told apart by what it answers, and sent to the RPC families.

Two things are translated in the transport rather than in the profiles. A Gen1 counts energy in
**watt-minutes** (`meters[].total`), a unit the platform has none of, so every `meters[]` entry
gains `total_wh`, the same count in watt-hours, which is what the profiles read; the EM and 3EM
count in watt-hours already (`emeters[].total`) and are read as they are. And a `brightness` is
sent whole and between 1 and 100, a `roller_pos` whole and between 0 and 100 - what the API
accepts.

### The Gen1 families

| Driver            | Models                 | Entities                                                                                    |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `gen1-switch`     | 1 Gen1 (`SHSW-1`)      | relay                                                                                       |
| `gen1-switch-pm`  | 1PM Gen1, 1L Gen1      | relay, power, energy, device temperature                                                    |
| `gen1-plug`       | Plug Gen1, Plug S Gen1 | as `gen1-switch-pm`                                                                         |
| `gen1-switch-2pm` | 2.5 in **relay** mode  | two relays, power and energy each, device temperature                                       |
| `gen1-cover-pm`   | 2.5 in **roller** mode | cover (position, open, close, stop, go to), power, device temperature                       |
| `gen1-dimmer`     | Dimmer Gen1, Dimmer 2  | light (on, off, brightness), power, energy, device temperature                              |
| `gen1-em`         | EM Gen1                | the contactor relay; power, reactive power, voltage, energy, returned energy per channel    |
| `gen1-3em`        | 3EM Gen1               | the contactor relay; power, voltage, current, power factor, energies per phase; total power |
| `gen1-inputs`     | i3                     | three inputs, as binary sensors                                                             |

The Shelly 1's `meters[0].power` is a constant the owner types in its web page, not a
measurement, so `gen1-switch` has no power entity; the Plug has no temperature sensor, so its
device temperature stays empty. The EM and 3EM relay takes only `on` and `off`, so it has no
toggle.

## Found on the network

Every Shelly announces itself over mDNS - Gen2+ as `_shelly._tcp` and `_http._tcp`, Gen1 as
`_http._tcp` alone - under a name that starts with `shelly`, and `discovery.json` says what to do
with one: ask it `GET /shelly`, which every generation answers without a password, and read the
hardware code off the answer - `model`, or a Gen1's `type`. Each driver's `modelCodes` maps the
codes it claims onto the models it lists, so a Shelly found on the network is proposed as the
driver and the model it is, under the name it was given in the Shelly app (a Gen1 gives none over
`/shelly`, and is proposed under its MAC). The 2PM reports one code whether it runs as two relays or
as a cover, and a Gen1 2.5 one code in either mode; the two drivers that map it tell which from
the answer. A Shelly of a family this bundle does not drive is not proposed, and one already added
is not probed again.

## Firmware, and the web page

Every driver exposes two more entities: **Firmware update**, a binary sensor that is on while the
device offers a stable update, and **Install firmware update**, a button that asks it to install
one. Over RPC the sensor reads `sys.available_updates.stable` and the button calls `Shelly.Update`
with stage `stable`; on a Gen1 the sensor reads `update.has_update` from `/status` and the button
asks `/ota?update=true`. The device checks for updates on its own and needs the internet to do
it; once it has installed one it restarts, drops off the network for a minute, and its sensor
reads up to date again. The device's page links to its own web page, on port 80.

## What is not here, and why

**Readings some devices only have when wired for them.** The Dimmer Gen3 and Gen4 measure power
only with a neutral wire; without one their power, energy, voltage and current entities stay
empty. A cover reports its position only once calibrated from its web page, and a position needs
the calibration too; an uncalibrated cover says nothing at all rather than a motion without a
position (a Gen1 2.5 parks an uncalibrated position on 101, which no cover can be at).

**Device temperature where a model has none.** A family reads the temperature where the models
that have one report it; a model of the family without a sensor - the Plug, possibly the Plus 1
Mini or the Plus Wall Dimmer - leaves that entity empty. Energy counters on a Gen1 relay start
again from zero after a reboot, which the history reads as a counter reset.

**Inputs in button mode.** An I4 input set up as a button reports presses as events, which are
not state; its `state` is null and its entity stays empty. As a switch, it reports on and off.
An i3 input reports its level, 0 or 1, in either mode.

**Battery devices.** They sleep, and wake only to push. Over RPC - the H&T Gen3, Plus H&T, Plus
Smoke, Flood and Flood S - the push is an outbound WebSocket to a server they are configured to
reach, which is a server in the hub and a piece of work of its own. On Gen1 - the H&T, Door/Window
1 and 2, Flood, Smoke and Button1 - the push is CoIoT, whose payload this bundle does not read: it
only takes it as a signal to ask over HTTP, and a sleeping device does not answer HTTP. The Gen1
Motion stays on Wi-Fi, but is a sensor family of its own, like the Gas.

**Bulbs, RGBW, and the Presence sensor.** A Duo Bulb's white is in Kelvin and a colour bulb's
colour in red, green and blue; the canonical model speaks mireds and hue and saturation, and
converting one into the other is computation, which a profile does not do. That is the Gen1
Bulb, Duo, Vintage, RGBW2, 2LED and Spot, and the Plus RGBW PM and Pro RGBWW PM. The Presence
Gen4's components are not documented yet.

**The rest of the range.** The BLU gateways and everything Bluetooth, the Camera, The Pill, the
X MOD1, Cury, the Wall Displays, the Pro CB circuit breakers, the Plus Uni and Gen1 UNI, the Gen1
Air and TRV are not relays or meters of these layouts, and each would be a family of its own. The
Gen1 Shelly 2 (`SHSW-21`, one meter for both channels) and 4Pro are discontinued and not here; the
Gen1 Plug E and Plug US and the Dimmer W1 are in Home Assistant's list, but the Gen1 docs show no
status of theirs to write a profile against. The Plus 0-10V's early revision (`SNGW-0A11WW010`)
is left out for the same reason.

## What is and is not checked against hardware

A Gen3 dimmer's `GET /shelly` has been read on the bench, and it is what discovery is built on.
Nothing else here has met a device: no Gen1 and no Gen2 exists in the house. The frames, the
digest and the notification overlay follow Shelly's API documentation and Home Assistant's client;
the Gen1 requests, the CoIoT packet layout and the serial follow the Gen1 documentation and
`aioshelly`. Both transports are tested against devices simulated from the documented frames and
answers, and the profiles against statuses shaped after the documentation's own examples.

What a device would settle first:

- **The model codes.** If a device on the network stays `identifying`, the hub logs what it heard:
  the address and what the device said of itself, `model` or `type` included. A code missing from
  a family's `oneOf` in its `profile.json` is the whole fix: add it there, its label to `models`
  and the pair to `modelCodes` in `driver.json`, in the same position.
- **The 2.5's `mode` in `/shelly`**, which only recent Gen1 firmware reports; a 2.5 on an older one
  is claimed by neither of its drivers until it is updated.
- **The Pro 3EM's `profile`**, reported since firmware 1.1.0; an older one is claimed by nothing.
- **CoIoT on the hub's network**: that the multicast reaches the hub (same subnet, IGMP snooping
  permitting) and that port 5683 is free there. The log says once at info when the socket cannot
  be opened; the devices then change at the poll's pace, which is the thing to notice.
- **Temperature and readings per model** - which Gen2 and Gen1 models report a device temperature
  where the family reads it.
