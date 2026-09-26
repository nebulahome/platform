# bambu-lab

A Bambu Lab printer in **LAN mode**, over the MQTT broker the printer runs itself: the chamber
camera, the lights, the nozzle, bed and chamber temperatures, the fans, the AMS and the print in
progress, with pause, resume and stop. Every printer Bambu sells today - the X1s, the P1s, the
A1s, the A2L, the P2S, the H2s and the X2D - in four drivers, one per family.

## What the printer is

Unlike a Shelly, which is reached by address over HTTP, a Bambu printer **is a broker**. It listens
on port 8883, behind TLS with a certificate it signed itself, and lets in exactly one user:

| Setting  | Value                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ |
| URL      | `mqtts://<printer address>:8883`                                                           |
| Username | `bblp`, always                                                                             |
| Password | the **access code** - eight characters, on the printer's screen under the network settings |

The printer publishes its state on `device/<serial>/report` and takes requests on
`device/<serial>/request`. The serial is the one on the box and on the printer's screen; the
bundle never needs to be told it, because it reads it off the topic the printer speaks on.

## Setting it up

One device of this bundle per printer. In the interface, **Integrations → Bambu Lab → Add
device** asks which model it is, what to call it, and the two things only the owner knows - the
printer's address and its access code - and **Test** opens one session to the printer before
anything is saved, so a
mistyped code is refused with `Connection refused: Not authorized` rather than discovered later
in a log. The address must be `mqtts://`: the printer has no plain-text listener, so
`mqtt://<address>:1883` is refused by the printer with `ECONNREFUSED` - the host answered, nothing
listens on that port - and the form refuses it first, saying why. The other two settings the
broker needs come from `setup.json` as constants and never appear in the form, so the row the hub
reads is:

```json
{
  "url": "mqtts://192.168.1.60:8883",
  "username": "bblp",
  "password": { "$sealed": "v1:…" },
  "shouldVerifyCertificate": false
}
```

The access code is sealed with `NEBULA_SECRETS_KEY` by the API and opened by the hub when the
instance starts; it is never served back.

`shouldVerifyCertificate: false` is not optional, which is why it is a constant. The printer
signs its own certificate and is reached by address, so there is nothing the certificate could be
checked against; with it on, the handshake is refused and the instance sits in `failed` with a
message about a self-signed certificate. What is given up is the guarantee that the thing at that
address is the printer; what is kept is that the traffic is encrypted. On a home network that is
the right trade, and the constant records that it was made.

Once saved, the hub starts the instance at once and the device shows `identifying`: the hub
listens on `device/+/report` and claims whatever reports a `print` block, by the serial in its
topic, then asks `core` to complete the device's row with that serial and the printer's
entities. From then on the bundle subscribes to that printer's report topic and asks it for a
full status - see below for why that matters - and the readings are on the device's row,
changing as the printer reports. The claim stays on the row, so a restarted hub watches the
printer again on its own without listening for it twice.

**A P1 or an A1 can sit in `identifying` for a while.** Those printers report on change and when
asked, and the hub cannot ask before it knows the serial, which is the thing it is listening
for. Touching a setting on the printer's screen, or turning its light on, gives the hub
something to hear; the hub listens again as soon as a pass ends empty, so nothing has to be
restarted. An X1 reports on its own every few seconds and is identified within them. The serial
is on the box and on the printer's screen; the entity ids are composed from the device's id
(`sensor.bambu_lab_x1c_nozzle_temperature`), not from the serial, so a replaced printer keeps
its automations.

## Finding a printer

A printer in LAN mode announces itself every few seconds over SSDP - to the group
239.255.255.250 on port 1990, and as a broadcast on port 2021, where Bambu Studio listens - and
`lan/discovery.js` listens on both. The announcement carries the printer's address, its serial
(`USN`), the model code Bambu's own software knows it by (`DevModel.bambu.com`), the name its
owner gave it and its firmware; the candidate that appears on the vendor page is already
`mqtts://<address>:8883`, and the owner types only the access code. The model codes are the
drivers' `modelCodes`, taken from Bambu Studio's printer definitions:

| Code                             | Printer                    | Driver                |
| -------------------------------- | -------------------------- | --------------------- |
| `3DPrinter-X1`, `BL-P002`        | X1                         | `printer`             |
| `3DPrinter-X1-Carbon`, `BL-P001` | X1C                        | `printer`             |
| `C13`                            | X1E                        | `printer`             |
| `N7`                             | P2S                        | `printer-p2s-h2s`     |
| `O1S`                            | H2S                        | `printer-p2s-h2s`     |
| `O1D`, `O1E`, `O1C`/`O1C2`, `N6` | H2D, H2D Pro, H2C, X2D     | `printer-dual-nozzle` |
| `C11`, `C12`, `N2S`, `N1`, `N9`  | P1P, P1S, A1, A1 mini, A2L | `printer-p1-a1`       |

A printer the router keeps off multicast, or on another subnet, is added by hand as before.

## Drivers

One per family, so that a printer has the entities it can fill and no others:

- **`printer`** - X1, X1C, X1E. RTSP camera, one nozzle, the chamber sensor, the door read
  from `home_flag`, the SD card.
- **`printer-p2s-h2s`** - P2S, H2S. RTSP camera, one nozzle, a heated chamber with its target,
  the door read from `stat`, both light bars.
- **`printer-dual-nozzle`** - H2D, H2D Pro, H2C, X2D. As above, with two nozzles instead of one.
- **`printer-p1-a1`** - P1P, P1S, A1, A1 mini, A2L. The still camera, one nozzle, no chamber
  sensor (a P1 reports a number there that means nothing), the SD card.

## Entities

| Entity                             | Domain          | From                                                                               |
| ---------------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| Chamber light                      | `light`         | `lights_report[0].mode`; on an H2 or X2D both light bars are switched              |
| Chamber camera                     | `camera`        | the stream below; available while `ipcam.rtsp_url` is not `disable`                |
| Nozzle temperature / target        | `sensor` °C     | `device.extruder.info[0].temp` packed, or `nozzle_temper` / `nozzle_target_temper` |
| Right / left nozzle, and targets   | `sensor` °C     | `device.extruder.info[0]` (right) and `[1]` (left), packed                         |
| Nozzle diameter                    | `sensor` mm     | `nozzle_diameter`                                                                  |
| Bed temperature / target           | `sensor` °C     | `device.bed.info.temp` packed, or `bed_temper` / `bed_target_temper`               |
| Chamber temperature / target       | `sensor` °C     | `device.ctc.info.temp` packed, or `chamber_temper`                                 |
| Printing                           | `binary_sensor` | `gcode_state` is `RUNNING`                                                         |
| Print status                       | `sensor` text   | `gcode_state`, in words                                                            |
| Stage                              | `sensor` text   | `stg_cur`, in words - `-1` and `255` are both idle                                 |
| Print progress / remaining time    | `sensor`        | `mc_percent`, `mc_remaining_time`                                                  |
| Layer / total layers               | `sensor`        | `layer_num`, `total_layer_num`                                                     |
| Speed level                        | `sensor`        | `spd_lvl` - 1 silent, 2 standard, 3 sport, 4 ludicrous                             |
| Print name / G-code file / source  | `sensor` text   | `subtask_name`, `gcode_file`, `print_type`                                         |
| Print error / health alerts        | `binary_sensor` | `print_error` other than 0; `hms` not empty                                        |
| Fans                               | `sensor` %      | `cooling_fan_speed`, `big_fan1_speed`, `big_fan2_speed`, `heatbreak_fan_speed`     |
| Wi-Fi signal                       | `sensor` text   | `wifi_signal`, as the printer writes it (`-47dBm`)                                 |
| Timelapse                          | `binary_sensor` | `ipcam.timelapse` is `enable`                                                      |
| LAN developer mode                 | `binary_sensor` | bit 29 of `fun` clear: the firmware takes unsigned commands                        |
| Door                               | `binary_sensor` | bit 23 of `home_flag` (X1) or of `stat` (P2S, H2, X2D)                             |
| SD card                            | `binary_sensor` | bit 8 of `home_flag` (X1, P1, A1)                                                  |
| AMS humidity / temperature         | `sensor`        | `ams.ams[0].humidity_raw`, `ams.ams[0].temp` - the first unit                      |
| Pause, Resume, Stop print, Refresh | `button`        | `print.pause`, `print.resume`, `print.stop`, `pushing.pushall`                     |

**Packed readings.** Newer firmware - the H2s, the X2D, the P2S - reports a temperature as one
integer, the current value in the low 16 bits and the target in the high 16, and moves the
bed and chamber readings under `device`. The profile reads them with `bits` and tries the new
place first and the old one after, so a printer on either firmware fills the same entity. Right
is extruder 0 and left extruder 1, as Bambu Studio numbers them.

**Commands need developer mode.** Firmware from the start of 2025 accepts a command over the
LAN only when it is signed with a key only Bambu's cloud has - unless **LAN only mode** and
**Developer mode** are both on in the printer's network settings. The _LAN developer mode_
sensor says which the printer is in; with it off the readings and the camera still work, and the
light and the buttons are ignored by the printer. _Stop print_ asks before it is sent: a print
stopped cannot be resumed.

## The camera

Every printer has one, and every driver has the `camera.chamber_camera` entity; how the
picture arrives depends on the family, and `camera/stream.js` reads both:

- **RTSP over TLS**, port 322, H.264: the X1s, the H2s, the P2S and the X2D. The printer serves
  it only with **LAN Mode Liveview** on (Settings → Network on the printer's screen); off, it
  reports `ipcam.rtsp_url` as `disable`, the entity says the camera is not streaming, and a
  stream asked for anyway fails saying to turn it on.
- **JPEG stills over TLS**, port 6000, about one a second: the P1s, the A1s and the A2L. An
  80-byte greeting with the user `bblp` and the access code, then each picture behind a 16-byte
  header whose first bytes are its length. The card shows the latest still until play is
  pressed.

Both are reached at the host of the instance's `mqtts://` address with the access code the
broker already takes, and behind a certificate the printer signed itself, checked against
nothing for the reason the broker's is not. The hub only relays the frames; the browser decodes
them, so nothing is transcoded and a stream runs only while somebody watches it.

## What a profile cannot say, and why

**Full reports and deltas.** An X1 pushes its whole status every second. A P1 or an A1 pushes only
what changed, and only after being asked once for everything - which is what the `pushall` in
the subscriptions is for. It is sent every time the session comes up and every five minutes
after, so a missed delta is a five-minute gap rather than a permanent one. Between those, a delta
naming only the nozzle changes only the nozzle: the mapper reads absence as absence, and a light
that was not mentioned stays exactly as it was.

**The light is index zero.** `lights_report` is a list, and the profile grammar can index a list
but cannot search one. On every model this bundle names, `chamber_light` is the first entry - an
X1 lists a `work_light` after it. If a printer ever lists them the other way round, the light
here will be the wrong one, and `[0]` in `profile.json` is the thing to change. The same holds
for the extruders and the AMS units, read by position.

**Setting things is not here.** Target temperatures, fan speeds, the print speed and the AMS
need capabilities for a number to set and a list to choose from, which the canonical model does
not have yet. The firmware update is not here either: Bambu's is installed through its cloud.

## What is and is not checked against hardware

There is no printer on the test bench. The bundle is tested against a simulated one on the
development broker - it answers `pushall` and `ledctrl` the way the firmware is documented to -
and against the payloads the community has recorded from real printers.

**The TLS handshake is settled.** `shouldVerifyCertificate: false` is passed straight through to
the client as `rejectUnauthorized: false`, and a real printer on a home network took the handshake
and answered the connect packet - `Not authorized` to a deliberately wrong code, which is the
broker speaking, past TLS. A certificate error from an instance would therefore be news, and the
message will name what the client objected to.

**So is the identification.** The same printer answered the wildcard subscription the hub
listens on, `device/+/report`, within seconds of being asked, was identified from the interface
without a hand on it, and reported every entity above except the chamber temperature - which a
P1S does not have, as the entities table says. If a device stays `identifying` while a printer is
on and in LAN mode, the printer is idle and quiet: a P1 or an A1 reports on change, so touching a
setting on its screen, or turning its light on, gives the hub something to hear.
