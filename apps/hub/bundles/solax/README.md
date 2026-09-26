# solax

SolaX Power inverters - grid-tie, hybrid with a battery, AC-coupled retrofit - and the X3-EVC
charger, read on the house network. Six drivers: one for each kind of inverter - single- and
three-phase, hybrid or not - which reads it whichever way it is reached, the owner choosing the
way in the form; the AC-coupled retrofit, over Modbus only; and the charger, through its dongle
only. Nothing goes through SolaX Cloud, and nothing is written to the inverter: this release only
reads.

## Which way in: _Connection_

The first thing an inverter's form asks is **Connection**, and the rest of the form follows it:

| The inverter is reached through                                                 | Connection               | The form then asks                                  |
| ------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------- |
| a **Pocket WiFi 3.0** dongle on firmware **3.004.03 or later**                  | **Modbus TCP** (default) | address, Modbus port (502), unit ID (1), framing    |
| the inverter's **own Ethernet port** (hybrids of the 2nd and 3rd generation)    | Modbus TCP               | the same                                            |
| an **RS485-to-Ethernet adapter** on the inverter's COM port (any generation)    | Modbus TCP               | the same                                            |
| a **Pocket WiFi 2.0**, a **Pocket LAN**, or a Pocket WiFi 3.0 on older firmware | Dongle web API           | address, web page username (usually none), password |

For a Pocket WiFi 3.0, choose **Modbus TCP**: from firmware 3.004.03 it answers on port 502 with no
password, and recent firmware closes the web API to the LAN anyway (HTTP 405). The SolaX app
shows the dongle's firmware. **Test** says which way to try when the chosen one fails for a reason
that points at the other: nothing taking a Modbus connection on port 502 (older firmware - try the
web API), or a web API answering 405 (closed - try Modbus TCP). A **Pocket LAN has no Modbus** -
the Modbus integration's documentation says so plainly - and a Pocket WiFi 2.0's is unreliable,
so those are read through the web API. An adapter on the COM port is the way that works for every
generation, and the only one for a fourth-generation inverter without a Pocket WiFi 3.0: the
fourth generation has no Ethernet, and **its COM port is RS485 even where a manual calls it
Ethernet - never plug it into a switch**.

The four inverter drivers name the transport `solax/inverter` (`inverter/transport.js`), which
hands every request to one of the bundle's two others - `solax/modbus` or `solax/local` - as
Connection says. Both hand the profiles **named values, already scaled**: `values.battery_power`,
`values.grid_power`, `values.pv_power` mean the same whichever way the inverter is reached, and
one profile reads it either way. What still differs, `solax/inverter` makes the same on every
payload:

- `serial` is **the inverter's own serial number**: read from its registers over Modbus, and from
  the dongle's `Information` through the web API, where the dongle reports it (most do); the
  dongle's `sn` stands in where it does not, and goes along as `dongleSerial`. So an inverter is
  the same device whichever way it is read, and a replaced dongle does not make it a new one.
- `protocol` (SolaX's register document version, which a poll over Modbus is given back) is 0
  through the web API; `connection` says which way the payload was read.

The retrofit (`modbus-retrofit`, `solax/modbus`) and the charger (`ev-charger`, `solax/local`)
are reached one way each, and their forms ask no Connection.

## The dongle API (`solax/local`)

The dongle answers one question on port 80 - `optType=ReadRealTimeData` with its password in
`pwd` - with a JSON object: its own serial `sn` (the registration number), its firmware `ver`,
the inverter's `type`, `Information` (the inverter's own serial is in it), and `Data`, a flat
list of the inverter's registers. The protocol, the request forms and the register tables are the
ones of the `solax` library Home Assistant's core `solax` integration requires
(github.com/squishykid/solax), re-expressed as data in `local/families.js`.

- **Asking.** Three ways have been seen and the firmware decides which it takes, so the transport
  tries them in turn and keeps the one that worked: a POST to `/` with the form
  `optType=ReadRealTimeData&pwd=<registration number>` as its body (the V3 dongles); the same
  as a query string with a trailing `&` (the 2.x firmware, reported to crash without it); a GET of
  `/api/realTimeData.htm` without a password (the X-Hybrid). The POSTs carry
  `X-Forwarded-For: 5.8.8.8`, the dongle's hotspot address: firmware 2.034 closes a connection it
  takes to come from the LAN otherwise.
- **The password** is the dongle's **registration number**: the ten characters on its label
  (`SXXXXXXXXX`), also the name of the Wi-Fi hotspot it opens, unless it was changed in the SolaX
  app. Some old Pocket WiFi 2.x sticks take `admin`, an X-Hybrid none. A wrong one is refused
  with HTTP 401, and **Test** says `refused the password`.
- **Which family.** `type` is an integer code on firmware from 2.034 on and a model string before
  it (`X1-Boost-Air-Mini`, `X3-MIC`, `X1-Hybiyd-G3` - the firmware's spelling). Two codes are two
  tables each, told apart by how many registers came back; the owner may pick the other table on
  the device's form (_Register table_) the way Home Assistant asks when its discovery matches two.
- **One request per interval.** However many entities a device has, a poll is one HTTP request;
  a dongle that did not answer at all (a grid-tie inverter's dongle is off every night) is not
  asked the other ways.
- **The identity** of an inverter is its own serial, as above. The X3-EVC's is the dongle's
  serial `sn`, what Home Assistant keys it by too; a replaced dongle is a new charger.

| Family (`local/families.js`) | `type`               | Registers      | Driver                                                   |
| ---------------------------- | -------------------- | -------------- | -------------------------------------------------------- |
| `x1_mini`                    | `X1-…` string        | 69             | `inverter-single-phase`                                  |
| `x1_boost`                   | 4                    | 100, 200       | `inverter-single-phase`                                  |
| `x1_mini_v34`                | 4                    | 69 (or picked) | `inverter-single-phase`                                  |
| `x1_smart`                   | 8                    | 100-200        | `inverter-single-phase`                                  |
| `x1_g4_series`               | 18, 22               | 100            | `inverter-single-phase`                                  |
| `x3`                         | `X3-…` string        | 102, 103, 107  | `inverter-three-phase` (an X3-MIC), `hybrid-three-phase` |
| `x3_mic_pro_g2`              | 16                   | 100            | `inverter-three-phase`                                   |
| `x_hybrid`                   | a string, legacy GET | 58, 68         | `hybrid-single-phase`                                    |
| `x1`                         | `X1-…` string        | 102, 103, 107  | `hybrid-single-phase`                                    |
| `x1_hybrid_gen4`             | 15                   | 200-300        | `hybrid-single-phase`                                    |
| `x1_lite_lv`                 | 103                  | 200-300        | `hybrid-single-phase`                                    |
| `x3_v34`                     | 5                    | 200            | `hybrid-three-phase`                                     |
| `qvolt_hyb_g3_3p`            | 14                   | 200            | `hybrid-three-phase`                                     |
| `x3_hybrid_g4`               | 14                   | 200-300        | `hybrid-three-phase`                                     |
| `x3_ultra`                   | 25                   | 300            | `hybrid-three-phase`                                     |
| `x3_evc`                     | 1                    | 96             | `ev-charger`                                             |

Where this table departs from the library, it says why beside the reading. In short: a battery
current the library reads unsigned (X1-Hybrid G4) is read signed; the X1-Lite LV battery power
is taken in watts, not divided by ten (the library's own samples: 2587 W beside 53.8 V × 48.0 A);
lifetime counters over two registers are read unsigned where the library applies a 16-bit sign
(X1-Lite LV battery, X3-EVC); the X1-Boost/Mini G4 feed-in power is the low register signed,
which equals the library wherever the library is right and reads an import besides.

**Newer firmware.** SolaX has been closing the local API to the LAN on newer dongle firmware. The
transport asks a fourth way for it - the form POST with `Host: 5.8.8.8`, the dongle's own hotspot
address, which such a dongle answers (solax#151) - and, when the owner gives the **Username** of
the dongle's web page (usually `admin`), sends it and the password as Basic credentials on every
request. The password is the one of the dongle's web page: its registration number unless changed.
A dongle that still answers every way with HTTP 405 has shut its local API to the LAN for good;
**Test** says so and says to set Connection to _Modbus TCP_, which the Pocket WiFi 3.0 answers on
port 502 from firmware 3.004.03 without a password.

What **Test** says when nothing comes back is worth reading closely, because the three silences
mean different things:

- _did not take a connection on port 80_ - nothing accepted the connection at all. Either the
  address is not the dongle's, or its firmware ignores the LAN entirely, which some recent
  firmware does: the dongle answers only its own hotspot and SolaX's cloud. Modbus TCP is the way
  in then, when the dongle offers it; the discovery below finds it on port 502 if it does.
- _took the connection and did not answer in time_ - a dongle, busy or slow, that may answer a
  second **Test**.
- _answered with something that is not HTTP_ - something else lives at that address.

The transport reads an answer as soon as it is whole - an error status at once, data as soon as
the JSON parses - and asks for the connection to be closed, because some dongles keep it open
after answering, with no length to say where the answer ends.

## Modbus TCP (`solax/modbus`)

A small Modbus client over `node:net`: function 03 (holding registers) and 04 (input registers),
nothing else. The serial prefixes, which register holds what, input or holding, scale, sign and
word order are those of the Home Assistant integration `solax_modbus`
(github.com/wills106/homeassistant-solax-modbus, `plugin_solax.py`), re-expressed as data in
`modbus/families.js`.

- **Read-only.** No mode, limit or remote-control register is written, and the unlock code SolaX
  asks before a setting changes is not sent.
- **One socket per address, in the whole hub**: the polls of every unit behind it, the Test
  button, identification and the discovery sweep all ask through the one client, kept by the
  module rather than by each transport made from it - many adapters, and the Pocket WiFi 3.0, take
  one client at a time, and a second connection opened beside a poll's would be refused or would
  push the poll's off. Requests go one after another, 100 ms apart; one that times out drops the
  socket and the next opens it again.
- **Patient, and lenient.** A block a poll gets no answer to is asked once more before the poll
  gives up, as the integration retries once; an answer to the function asked is taken even when a
  gateway echoes another unit id, or 0 for the transaction, since one request is ever on the
  wire.
- **Framing.** _Modbus TCP_ (the MBAP header, a transaction id per request) for a Pocket WiFi 3.0,
  the inverter's own port, or an adapter set to "Modbus TCP to RTU" - what the integration's
  adapter guide recommends. _RTU over TCP_ for an adapter in transparent mode, which passes RTU
  frames (CRC and all) through as they are.
- **Identifying.** The serial number is fourteen ASCII characters in seven holding registers at
  0x0, else at 0x300 (byte-swapped by some inverters, swapped back when it does not start with M
  or X), else at 0x1A10. Its prefix names the family: `H450…` an X1-Hybrid G4, `H34…` an X3-Hybrid
  G4, `H3BC25…` an X3-Ultra with a third string, `XB3…` an X1-Boost, `MPT…` an X3-MIC PRO G2. The
  fifth and sixth generation moved some readings at version 1.00 of SolaX's register document;
  the transport reads that version (holding 0x82) once and picks the layout, as the integration
  does. The next place is tried when one is refused or left unanswered. The serial is the
  device's identity. **Test** reads only the serial - one request, well inside the time a Test
  has, even from a slow dongle - and so does the discovery sweep.
- **Blocks, not entities.** The registers a family needs are grouped into reads: contiguous, at
  most 100 registers (the integration's block size for SolaX), a gap of more than 16 unused
  registers or a register the integration always starts a block at starting a new one. Each
  block is read once per interval and one payload is delivered: an X1-Hybrid G4's 28 entities are
  three reads - input 0x00-0x22, input 0x46-0x53, holding 0x8B.
- **A refused block** (a Modbus exception - a register this firmware does not have) is left out
  and the rest delivered, as the integration does; a unit that does not answer fails the poll,
  and the entities go stale until it answers again.

What **Test** says over Modbus:

- _takes no Modbus TCP connection_ - nothing listens on the port. A Pocket WiFi 3.0 answers on 502
  from firmware 3.004.03; older firmware, a Pocket WiFi 2.0 and a Pocket LAN have no Modbus - set
  Connection to _Dongle web API_ for those.
- _took the connection, but unit N did not answer_ - the unit ID is not the inverter's: 1 for a
  Pocket WiFi 3.0, the address in the inverter's Modbus menu otherwise.
- _answers Modbus, but …_ - something answered with no SolaX serial this bundle knows.

| Family (`modbus/families.js`) | Serial prefixes                                     | Driver                  |
| ----------------------------- | --------------------------------------------------- | ----------------------- |
| `hybrid_g2_x1`                | L30, L37, L50, U30, U37, U50                        | `hybrid-single-phase`   |
| `hybrid_g3_x1`                | H1E, H1I, HCC, HUE, XRE                             | `hybrid-single-phase`   |
| `hybrid_g4_x1`                | H43, H44, H450, H460, H475, 63150                   | `hybrid-single-phase`   |
| `hybrid_g5_x1`, `…_pv3`       | H53; H55, H56, H58                                  | `hybrid-single-phase`   |
| `hybrid_g6_x1`                | 10M                                                 | `hybrid-single-phase`   |
| `hybrid_g3_x3`                | H3DE, H3E, H3LE, H3PE, H3UE                         | `hybrid-three-phase`    |
| `hybrid_g4_x3`                | H34, H31                                            | `hybrid-three-phase`    |
| `hybrid_g5_x3`, `…_pv3`       | H35A0/A1, P35A0/A1, H35F0/F1; H3BC/D/F/G (X3-Ultra) | `hybrid-three-phase`    |
| `hybrid_g5_x3_aelio`          | 8021                                                | `hybrid-three-phase`    |
| `hybrid_g6_x3`                | 10K                                                 | `hybrid-three-phase`    |
| `ac_g3_x1`, `ac_g3_x3`        | XAC, PRI; F3D, F3E                                  | `modbus-retrofit`       |
| `ac_g4_x1`, `ac_g4_x3`        | F43, F450, F460, F475, PRE; F34                     | `modbus-retrofit`       |
| `mic_g2_x1`                   | XAU, XB3, XBE, XBU, XAT, XM2, XM3, XMA              | `inverter-single-phase` |
| `mic_g4_x1`, `…_pv3`          | XB4, XM4, ZA4; XST                                  | `inverter-single-phase` |
| `mic_g1_x3`                   | MC103T, MC203T, … MU103T (the first X3-MIC)         | `inverter-three-phase`  |
| `mic_g2_x3`                   | MC806T, … MP156T, PU, MPT                           | `inverter-three-phase`  |

**What the inverter needs**, from the integration's documentation:

- a **Pocket WiFi 3.0 on firmware V3.004.03 or later** (SolaX only names the fourth-generation
  hybrids for it; it is the setup the integration marks as needing more testing);
- on an **X1-Air, X1-Boost or X1-Mini, ARM firmware 1.37 or later, and Modbus switched on in the
  inverter's admin menu** - earlier firmware speaks something else over RS485;
- on the first **X3-MIC**, ARM 1.38 or later for the grid meter's readings; do not poll it faster
  than every 5 s;
- the **Modbus address** set on the inverter (1 by default; some report 4) and, on an adapter,
  the inverter's baud rate.

## Polling

| Driver                                  | Default | Least | Warns under | Why                                                                            |
| --------------------------------------- | ------- | ----- | ----------- | ------------------------------------------------------------------------------ |
| the four inverter drivers, the retrofit | 15 s    | 5 s   | 10 s        | the Modbus integration's default is 15 s, and it advises against less than 5 s |
| the X3-EVC                              | 30 s    | 5 s   | 10 s        | Home Assistant's `solax` polls every 30 s; the dongle is a small Wi-Fi stick   |

The owner changes it per device (_Update every_); an inverter read through an old Pocket WiFi 2.0
is kinder at 30 s. An X1-Mini G4 has been reported to answer only at the integration's 15 s.
Either way a poll is one request (web API) or one read per block (Modbus), never one per entity.

## Entities, and the energy card

Every inverter driver has PV power (the strings added up), per-string power, voltage and
current, the output power, voltage and current (per phase on three-phase models), grid
frequency, **feed-in power**, **home power**, yield today and in total, the grid meter's feed-in
and import counters, and the inverter temperature; the hybrids add the battery's power, level,
voltage, current and temperature (and on most, its charge and discharge counters); the newer
ones a run mode and the battery mode as text. The AC-coupled retrofit has no strings and no home
power: the PV inverter it sits beside is not seen from it, so output less feed-in would not be
the house. An entity a given family does not report stays empty: the tables above and the
comments in the `families.js` say which. Read through the web API, the readings only the
registers carry stay empty too: on an X1-Hybrid G4, the run mode, the battery mode and the
battery's charge and discharge counters.

For the dashboard's energy card:

| Card field    | Entity        | Sign                                              | Card switch (`isGridImportPositive`, `isBatteryDischargePositive`) |
| ------------- | ------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Solar power   | PV power      | always positive                                   | -                                                                  |
| Battery power | Battery power | **positive while charging**                       | _Discharging counts as positive_: **off**                          |
| Battery level | Battery level | %                                                 | -                                                                  |
| Grid power    | Feed-in power | **positive when exporting**, negative when buying | _Buying counts as positive_: **off**                               |
| Home power    | Home power    | output power less feed-in power                   | - (or leave empty: the card computes it)                           |

That is how SolaX signs them, on the dongle API and over Modbus alike (the Modbus integration
inverts both for Home Assistant's dashboard; this bundle leaves them as the inverter reports and
the card's switches do the inverting). Power is in W, energy in kWh (stored as Wh), the battery
level in %; the energy counters are `total_increasing`, so a daily one resetting at midnight is
read as a reset.

## Found on the network

Neither the dongle nor a Modbus server announces itself, so the vendor's own listener
(`lan/discovery.js`) asks the network: every address of every private IPv4 network the hub is on,
from the interface's real netmask (a /22 is 1022 addresses; anything wider is asked only in the
/22 around the hub), on port **502** first - Modbus TCP, identified by the serial number no
password guards, its prefix naming the model and the driver - and, only when nothing answered
there as a SolaX, on port **80** - the web API without a password. So a Pocket WiFi 3.0, which
answers both, is proposed once, the Modbus way, with Connection already chosen: the form asks
only what discovery could not fill. A server the hub already polls is asked through the poll's
own socket, never with a second connection. An address is asked only once its port accepts a
connection within 600 ms, 48 at a time; the sweep runs when listening starts, every half hour, and
on **Discover devices**. A dongle with a password answers nothing that says it is a SolaX, so it
is not proposed: add it by address. No firmware entities: neither API says an update is waiting.

## What is not here, and why

- **Writing anything**: modes, export limits, remote control, the Modbus unlock code.
- **X3-MAX** (`MAX…`), and the serial prefix `H3VC83`, which the integration files as a
  single-phase fourth generation under a three-phase model name.
- **The EV charger over Modbus** (a plugin of its own in the integration); the X3-EVC is read
  through its dongle API.
- **The third string of an X3-Hybrid G4 Pro of 8 kW and more** on register document 1.00 and
  later (the size is in the serial, in hexadecimal).
- **The grid power of an X1-Boost, X1-Mini or X1-Smart of the fourth generation over Modbus**: the
  integration reads a signed "CT power" at 0x408 and an unsigned "measured power" at 0x409, and
  which one is the meter is not settled. The dongle API reads it (`x1_g4_series`).
- EPS output, parallel-mode aggregates, the second meter, per-battery readings of two-port
  batteries, the battery level weighted by capacity (the lower of two levels is taken, as the
  integration does when the capacities are unknown), the X3-EVC's external CT, charging duration
  and OCPP state.
- **SolaX Cloud**: a different path, with an API token and five-minute data.

## What has not been checked against hardware

**Everything.** There is no SolaX inverter in this house. The dongle API is tested against a
fake dongle answering with the `solax` library's recorded samples, and the Modbus transport
against a Modbus server in the test process answering from a register image; neither has met a
real dongle, inverter or adapter. What is most likely to need a fix, in order:

1. A current dongle firmware refusing the local API, or asking the password another way.
2. A serial prefix, a register or a scale on a model the integration has few reports of - the
   fifth and sixth generation, the Aelio, the X1-Smart G2, the retrofits.
3. The two-table codes (4 and 14) on the dongle API: if temperatures and meters read wrong, pick
   the other _Register table_.
4. A Pocket WiFi 3.0 closing its Modbus socket between polls; the transport reopens it on the
   next read.

A device that stays `identifying` has been heard but not claimed, or not heard at all: the hub
logs what answered - the dongle's `type` and register count, or the serial read over Modbus -
and a family or a prefix added to `families.js` is the fix.

## Credits

- The dongle protocol and register tables: the `solax` Python library, by Robin Wohlers-Reichel
  and contributors, MIT licence.
- The Modbus serial prefixes, register map, scales, block size and defaults: `homeassistant-solax-modbus`,
  by wills106 and contributors, Apache License 2.0. `modbus/families.js` is derived from its
  `plugin_solax.py`: re-expressed as data, renamed to this bundle's names, reduced to the readings
  shipped, with the changes noted beside them. No code of either project is copied.
