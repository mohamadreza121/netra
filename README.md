# Netra

Learn. Simulate. Master.

Netra is a browser-based networking education project for Cisco configuration practice. This foundation contains the landing page, the CCNA and CCNP topic roadmaps, and a LabSim preview with a selectable topology and sample console outputs.

## Run locally

Use Node.js 20 or newer.

```sh
npm run build
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/layout.mjs` | Shared navigation, page metadata, and footer |
| `src/pages/` | Home, practice-track template, and LabSim workspace |
| `src/features/practice/` | Track and topic definitions |
| `src/features/labsim/` | Interactive topology and console preview |
| `src/styles/` | Brand palette, layouts, and responsive styles |
| `src/assets/` | Netra mark and hardware artwork |
| `src/motion.js` | Hero scroll animation and CCNP topic rail |
| `scripts/build.mjs` | Generates four static routes in `dist/` |
| `docs/design-and-roadmap.md` | Brand directions and simulator and practice implementation plan |

A static host can build with `npm run build` and publish `dist`.
