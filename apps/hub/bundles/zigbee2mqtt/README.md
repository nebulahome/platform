# zigbee2mqtt

Zigbee devices through [Zigbee2MQTT](https://www.zigbee2mqtt.io) and a Zigbee coordinator - a USB
stick on this machine, or one on the network. NebulaHome **runs Zigbee2MQTT itself**, in a
container of its own beside its MQTT broker: the first bundle that depends on a container.

## What runs where

```
coordinator ── USB or tcp:// ──> Zigbee2MQTT (container nebulahome-zigbee2mqtt)
                                      │ MQTT, base topic zigbee2mqtt
                                      v
                                 Mosquitto (inside the platform's container)
                                      │
                                      v
                                 hub: zigbee2mqtt/mqtt ──> the bridge and every Zigbee device
```

The manifest declares the container (`containers`): the image `koenkk/zigbee2mqtt` on Docker Hub,
the oldest release the bundle works with (`minVersion` 2.1.0), where Zigbee2MQTT keeps its data
(`/app/data`), and what it is given - the broker, the adapter, the web page, always on and
published on the machine's port. Once the vendor is
set up, the supervisor downloads the newest 2.x release and runs it; the container is then the
integration's: its page shows it, and nobody starts, stops or updates it by hand. Its data - the
network's keys, every pairing, the coordinator's backup - lives in the data directory's
`containers/zigbee2mqtt/data`, so a NebulaHome backup takes it and a restore brings the Zigbee
network back with it.

## Setting it up

**Integrations → Zigbee2MQTT → Set up** asks:

| Setting               | What                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coordinator           | The chip the coordinator is built on: `ember` (Silicon Labs EFR32: Sonoff ZBDongle-E, Home Assistant SkyConnect, SLZB-06M), `zstack` (Texas Instruments CC26xx: Sonoff ZBDongle-P, SLZB-06), `deconz` (ConBee, RaspBee), `zigate`, `zboss` (Nordic nRF52840) |
| Connected by          | USB on this machine, or the network                                                                                                                                                                                                                          |
| Serial port           | For USB: its path, best under `/dev/serial/by-id/`, which stays the same across restarts                                                                                                                                                                     |
| Address               | For the network: `tcp://<address>:<port>`, as the coordinator's maker gives it (6638 for SMLIGHT)                                                                                                                                                            |
| Baud rate             | For USB, only when the coordinator's maker says: how fast the machine talks to it. Unset, Zigbee2MQTT's own default (115200)                                                                                                                                 |
| Hardware flow control | For USB, only when the maker says (some EFR32 sticks at 460800)                                                                                                                                                                                              |
| Web page port         | Zigbee2MQTT's own page - the network map, pairing, each device's own settings - always on, on this port of the machine (8099 unless changed)                                                                                                                 |
| Web page password     | What that page asks before it lets anybody in. Empty, it is open to the whole network                                                                                                                                                                        |

**Advanced settings** shows the rest - each left unset keeps Zigbee2MQTT's own default, since a
variable that is one setting and nothing else is not handed to the container until it is set:

| Setting                    | Variable                                                          | What                                                                               |
| -------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Zigbee channel             | `ADVANCED_CHANNEL`                                                | 11-26. Used only when the network is formed: changing it later means pairing again |
| Transmit power             | `ADVANCED_TRANSMIT_POWER`                                         | dBm, for a coordinator that takes it                                               |
| LED off                    | `SERIAL_DISABLE_LED`                                              | For a coordinator whose firmware lets it                                           |
| Log detail                 | `ADVANCED_LOG_LEVEL`                                              | Errors, warnings, information, debug - read on the container's page                |
| Last seen                  | `ADVANCED_LAST_SEEN`                                              | Whether and how each device says when it was last heard                            |
| Mains / battery gone after | `AVAILABILITY_ACTIVE_TIMEOUT`, `…_PASSIVE_TIMEOUT`                | Minutes before a device counts as unreachable (10 and 1500 unless set)             |
| Firmware updates           | `OTA_DISABLE_AUTOMATIC_UPDATE_CHECK`, `OTA_UPDATE_CHECK_INTERVAL` | Whether to look on its own, and how often; nothing installs unasked                |
| Remember states            | `ADVANCED_CACHE_STATE`                                            | States said again after Zigbee2MQTT restarts                                       |

Every variable is `ZIGBEE2MQTT_CONFIG_` and the name above; the environment overrides
`configuration.yaml`, so what is set here wins over an edit of that file.

Saving is what starts it: the supervisor pulls the image, writes a first `configuration.yaml` (a
new network, its keys generated), and starts the container on the platform's network. The page of
the container says where it stands; the vendor's page links to it.

Docker Desktop on Windows and macOS cannot hand a USB stick to a container: there, use a network
coordinator.

## Adding the devices

There is nothing to add by hand: everything Zigbee2MQTT knows is **added on its own**
(`"adopt": "automatic"` in `discovery.json`), from its `bridge/info` and `bridge/devices`, which
it keeps retained on the broker:

- **the bridge** - one device with whether Zigbee2MQTT is online, a _Pairing_ switch, how many
  devices it knows and its version;
- **each Zigbee device** paired and interviewed, known by its IEEE address - renaming it in
  Zigbee2MQTT changes nothing here. One just paired, whose friendly name is still its address, is
  named by its maker and model (`Aqara MCCGQ11LM`); rename it here as you like.

The vendor's page therefore has no _Add device_ and no _Discover devices_: in their place,
**Pair devices** is the bridge's _Pairing_ switch (`pairing` in `discovery.json`). It opens pairing
for 254 seconds, the longest Zigbee2MQTT allows - put the device in pairing mode then, and it is
added once Zigbee2MQTT has interviewed it. The button follows the switch live: pairing opened from
Zigbee2MQTT's own page shows as open here too, and **Stop** closes it from either side. While it
is open the button counts the time left down, and a **Pairing** panel says what to do and lists
the devices that joined since, as they are added.

**When nothing comes.** The listener says on the vendor's page when it cannot reach the broker, or
reaches it and hears nothing of Zigbee2MQTT for a minute - the case where Zigbee2MQTT was pointed
at another broker - with the broker it listens on and a link to the container's log, which says
which broker Zigbee2MQTT tried. A device Zigbee2MQTT lists and that is not added - still being
interviewed, a model it does not support, disabled in it - is listed under **Seen but not added**
with why. And because Zigbee2MQTT's retained messages reach the hub before a device just added is
bound to them, the transport keeps what it heard and hands it on again whenever the instances
change: the bridge's _Pairing_ switch is known at once, not at Zigbee2MQTT's next word.

A device removed here comes back while Zigbee2MQTT still has it: remove it in Zigbee2MQTT to
remove it for good.

## What a device becomes

One driver, `device`, for every model Zigbee2MQTT supports, written as code because what a device
exposes is the device's (`device/exposes.js`):

| Zigbee2MQTT exposes         | Entity                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `light`                     | a light: on and off, brightness, colour temperature (mireds, the device's range), colour (from x and y, or hue and saturation)                                                                 |
| `switch`, `fan`             | a switch, one per endpoint                                                                                                                                                                     |
| `cover`                     | a cover: position, tilt, open, close, stop                                                                                                                                                     |
| `lock`                      | a lock                                                                                                                                                                                         |
| `climate`                   | a thermostat: the temperature, the target, the modes the platform knows                                                                                                                        |
| `numeric` it publishes      | a sensor; temperature, humidity, pressure, illuminance, power, energy, voltage, current, battery, CO2, VOC and particles with their class, in the class's own unit (hPa read as Pa, kWh as Wh) |
| `binary` it publishes       | a binary sensor; a contact reads as _open_ when the door is                                                                                                                                    |
| `enum`, `text` it publishes | a text sensor: the last `action` of a remote                                                                                                                                                   |
| `supports_ota`              | the firmware: installed, offered, installing, and **install**                                                                                                                                  |

Not mapped yet: the device's settings (`category: config`, and what it takes without publishing),
lists and composites other than a light's colour. A device with nothing mapped still gets one
entity saying whether Zigbee2MQTT reaches it.

A device's state is not retained on the broker, so the hub asks each device for what it can be
asked (`/get`) when its link comes up; a battery device that cannot be asked is unknown until it
next reports. When Zigbee2MQTT says a device is offline (`/availability`), every entity of it is
unavailable.

## What is unverified

Everything was written against Zigbee2MQTT 2.x's documented topics and payloads, and checked
against a broker with Zigbee2MQTT played by the tests. It has not yet run against a real
coordinator: the first real pairing is the check.
