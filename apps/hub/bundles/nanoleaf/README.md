# nanoleaf

Nanoleaf panels on your own network - Light Panels, Canvas, Shapes, Elements, Lines - over the
controller's **OpenAPI**.

## What the controller is

The controller serves the OpenAPI on port **16021**, and every request carries a token **in its
path**: `http://<address>:16021/api/v1/<token>/state`. A request without one is refused. The token
is issued once: hold the controller's power button for five to seven seconds until its lights flash,
then within thirty seconds send `POST http://<address>:16021/api/v1/new` - the answer is
`{ "auth_token": "…" }`. That token is what the form asks for.

## The driver

One driver, `panels`, on the platform's `http` transport, with `pathPrefix: /api/v1/{token}` fixed
as a constant: the transport puts the owner's token there on every request. One entity, a `light`
with on/off and brightness, polled from `GET …/state` every five seconds and written with a `PUT`
of the state: `{ "on": { "value": true } }`, `{ "brightness": { "value": 40 } }`.

## Found on the network

A controller announces itself over mDNS as `_nanoleafapi._tcp`, with its model in the TXT record's
`md` - `NL42` for Shapes Hexagons - and `modelCodes` maps the codes onto the models listed. It
tells nothing to a caller without the token, so there is no probe: the controller is proposed from
its announcement, and adopting it asks for the token. Its serial is learned when the hub first
reaches it with the token.

## What is not here, and why

- **Hue, saturation and colour temperature**: the same PUT, but the colour model is the
  controller's and would need mapping into the platform's; a follow-up, not a new transport.
- **Effects, the panel layout, touch gestures, Rhythm**: lists and counts that depend on the
  controller, which is a code driver.
- **Pairing from the form**: the thirty-second window after the button is held is a flow the setup
  form does not have; the owner fetches the token once.

## What is and is not checked against hardware

The bundle's test runs it against a controller in the test process shaped after the OpenAPI
documentation. It has not been run against real panels; the model codes in `modelCodes` are the
ones documented for each product line and are the first thing to check against the `md` a real
controller announces.
