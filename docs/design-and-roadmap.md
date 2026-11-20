# Netra design and roadmap

## Palette options

| Direction | Foundation | Main accent | Supporting colors | Where it fits |
| --- | --- | --- | --- | --- |
| Celadon Relay · selected | Evergreen `#111C19` | Acid celadon `#D8F27B` | Chalk jade `#DCE8D8`, violet `#C1ADFF`, jade `#7CE9BD` | Editorial launch, warm hardware photography, legible console |
| Violet Circuit | Aubergine `#251B33` | Orchid `#D9B4F8` | Saffron `#EBC375`, slate lilac `#A79EBD` | Richer night-mode identity and warm port LEDs |
| Mineral Shift | Ink teal `#102C31` | Glacier jade `#A3E0CC` | Rhubarb `#F394AB`, salt `#F0E9D8` | Device diagrams, muted industrial surfaces, warmer editorial pages |
| Copper Signal | Dark umber `#271F22` | Copper rose `#E1AA92` | Petrol `#315358`, lemon `#DDE9A0` | Hardware-centric look with anodized-metal accents |

Use a clean grotesk for headings, the system sans stack for supporting copy, and monospace for commands and device labels. Keep neon accents for calls to action, active links, and meaningful state. Use line styles and text labels alongside color in the simulator.

## Landing page sequence

| Scene | Interaction |
| --- | --- |
| Home | Hardware appears in orbit behind the wordmark. Individual letters fall and fade as the reader leaves the hero. |
| CCNA | The background shifts to chalk jade. A real command example bridges the landing page and the practice catalog. |
| CCNP | Black and violet router consoles stack vertically, with verification examples for OSPF, BGP, route policy, and redistribution. |
| LabSim | A router, switch, and host share a small topology. The full workspace preview pairs that topology with a port inspector and console. |
| Footer | Return to the routes or open the source repository. |

## Build sequence

1. **LabSim MVP.** Define router, switch, host, interface, module-slot, and link data. Implement one router, one switch, and two hosts. Support Ethernet cabling and one generic expansion module with explicit slot compatibility. Model administrative and link state, IPv4 addressing, VLAN membership, and static routes. Use an IOS-style CLI state machine and derive command output from topology and configuration. Verify a working ping and a deliberately broken one. Save versioned local scenarios.
2. **CCNA practices.** Store exercises independently of UI. Each exercise needs a stable ID, starting topology, task, optional hints, accepted end state, and verification command. Start with interface setup, access VLANs, trunks, and static routes. Then add OSPF and IP services as simulator behavior becomes available.
3. **CCNP practices.** Extend supported state to OSPF areas, BGP sessions and attributes, route maps, redistribution, and L2 resilience. Add troubleshooting exercises that grade the outcome and can accept several valid configurations.

## Ideas for later phases

- Pair CLI verification with visual state changes and optional packet-path highlighting.
- Show front panels and compatible module bays in the device inspector so users can connect configuration to hardware.
- Include troubleshooting variants such as a VLAN mismatch or a missing return route.
- Provide reset and fork actions so learners can try two solutions from the same starting point.
