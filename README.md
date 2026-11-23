# Garbage Truck Simulator

Do more frequent trash pickups need more trucks? A toy model of one collection route,
with sliders for truck size, speed, container count and size, staffing, and garbage flux.

- `src/model.ts`: closed-form equations (`analyze`) and a minute-by-minute simulation (`Sim`) that checks them.
- `src/main.ts`: sliders, live MathJax equations, and the SVG animation.

## Develop

```sh
npm install
npx tsc --watch &
node serve.mjs   # http://localhost:8000
```

## Deploy

`.github/workflows/pages.yml` builds and publishes to GitHub Pages on every push to `master`.
In the repo settings, set Pages → Source to "GitHub Actions".
