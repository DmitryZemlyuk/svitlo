# Power Outage Schedule

Web page (PWA) with hourly power outage schedules for saved addresses.
Live at https://dmitryzemlyuk.github.io/svitlo/

- Addresses are found step by step: grid district → settlement → street → house, household or business consumer.
- Shows the current status with a countdown, today's and tomorrow's schedule, the queues in effect
  and all 12 sub-queues.
- Ukrainian (default), Russian and English.
- Works offline with the last loaded schedule; installable as an app.
- Push notifications (schedule changes, tomorrow's schedule, 30 min before an outage, sub-queue changes),
  each type can be turned on or off; off by default.

Addresses are stored in the browser's localStorage. The schedule and notifications come from a small
self-hosted service; it only knows the addresses of devices with notifications on.

Plain HTML, CSS and JavaScript, no build step. Published with GitHub Pages from the `main` branch.
