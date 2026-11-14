# Long soak and virtual SIP verification

The live EasyCall frontend currently launches the device dialer with `tel:`.
It does not contain a SIP user agent, browser WebRTC client, PBX, or carrier trunk.
These tests must not be described as end-to-end EasyCall SIP certification.

## Long API/DB soak

Two independent isolated PostgreSQL/PostgREST stacks: one camp with 2,000
virtual devices, and 20 camps with 100 devices each. Each stack has 1,000,000
fictional contacts. Devices ramp over three minutes, then run for five hours,
polling control approximately every 25 seconds and completing approximately
one synthetic call per minute. Tokens remain valid for six hours. The runner
checks sustained device counts, minimum completed work, errors, replay,
duplicate assignments, latency, and final DB count reconciliation. Resource
samples and partial progress are retained even on failure.

Five hours is not eight hours. GitHub-hosted jobs have a six-hour execution
limit, so the job allows 330 minutes including setup and artifact collection.
An eight-hour continuous soak needs a separately provisioned runner.

## Virtual SIP/RTP baseline

The official Ubuntu SIPp package runs UAC and UAS endpoints directly against
127.0.0.1 inside a new network namespace containing only the loopback interface.
No production hostname, carrier, SIP credential, or real destination is used.

Stages: 20-call signaling smoke; 2,000 concurrent signaling calls; 20-call RTP
smoke; 2,000 concurrent PCMU RTP calls. Large stages hold each call for 120
seconds after a 20-second ramp. A stable-window packet sample checks distinct
RTP streams, echo delivery, sample loss, and loopback round-trip time. SIPp
statistics check completed/failed calls and peak concurrent calls. This is
a baseline of the test tools on that machine, not a PBX or Internet voice
quality benchmark. The raw capture is removed after aggregate extraction.

## Still outside this evidence

Real SIP softphone integration, PBX/carrier capacity, WebRTC ICE/TURN/TLS/SRTP,
Internet/network impairment, subjective voice quality, real tablet audio,
production hardware and a full eight-hour continuous soak remain unverified.
There are no production application or schema changes in this test branch.
