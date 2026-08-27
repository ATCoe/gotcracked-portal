# Appointment runtime wiring

The appointment command center must be loaded from `portal-runtime-loader.js` through the `appointments` view dependency:

```js
appointments: ['appointments-board.js']
```

This requirement is enforced by `.github/workflows/appointments-command-center-guard.yml`.
