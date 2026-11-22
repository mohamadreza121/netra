# Netra

Learn. Simulate. Master.

Netra is a browser-based networking education project for Cisco configuration practice. It includes CCNA and CCNP practice tracks and a topology editor with simulators for IOS-style, client, and service consoles.

## Run locally

Use Node.js 20 or newer.

```sh
npm run build
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000.

## LabSim

Open `/labsim/` and choose a preset or build a topology from an empty workspace. Choose a device to open its console. Use `?` for contextual help, Tab for keyword completion, and unambiguous abbreviations such as `sh ip int br` and `sh ip rout`. **Commands for this device → Live LabSim** lists the syntax available in each mode. Workspaces autosave in the browser and can be exported and imported as JSON.

| Preset | Practice |
| --- | --- |
| Branch LAN | Access and trunk VLANs, router-on-a-stick, voice VLAN, and standalone Wi-Fi |
| Enterprise Campus | CAPWAP, a Catalyst 9800-style wireless controller, WPA2-Enterprise, ISE RADIUS and TACACS+, wired 802.1X, DHCP relay, SIP, and eBGP |
| Routing Core | GRE, multi-area OSPF, named and classic EIGRP, and route-map-controlled redistribution |
| Provider VPN | MPLS LDP, MP-BGP VPNv4, route targets, and VRF forwarding across a provider core |
| DMVPN Phase 3 | IKEv2 profile matching, mGRE, NHRP registration, and spoke-to-spoke forwarding |

Use the **Course Command Index** on the LabSim page to search CCNA, ENCOR, and ENARSI examples by command, topic, or device. Each entry opens the corresponding practice step with its prerequisites. The **Checked in LabSim** filter lists examples the device model accepted during the build-time command check. The **Guided practice** filter opens examples in the lesson console.

The topology editor supports up to ten of each device type. The IOS-style consoles share a forwarding model for supported routes, VLANs, ACLs, tunnels, QoS, wireless clients, and services. Spanning tree and routing updates follow configuration or link changes. IP SLA evaluates reachability on demand. The support for archive, TFTP, and startup configuration lets you restore device settings inside a saved topology.

LabSim runs in JavaScript with simulated packets and no firmware images. Cisco feature availability varies by platform and release. SD-WAN, overlay fabric inspection, controller APIs, and other platform-specific examples use guided scenarios with their own device state at `/labsim/ccnp/`.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/layout.mjs` | Shared navigation, page metadata, and footer |
| `src/pages/` | Home, practice-track template, and LabSim workspace |
| `src/features/practice/` | Track and topic definitions |
| `src/features/labsim/` | Topology, network behavior, and device consoles |
| `src/styles/` | Brand palette, layouts, and responsive styles |
| `src/assets/` | Netra mark and hardware artwork |
| `src/motion.js` | Scroll-driven rack assembly and word transitions |
| `scripts/build.mjs` | Generates the static routes in `dist/` |
| `docs/design-and-roadmap.md` | Brand directions and simulator and practice implementation plan |

A static host can build with `npm run build` and publish `dist`.
