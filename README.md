# Halton Hills Swim Schedule Importer

Scripts for importing Halton Hills swim schedules into Google Calendar, and for clearing them back out again. The importer expands a season CSV into recurring Google Calendar events, applying pool-specific colors and metadata so they can be managed in bulk later.

## Features

- Parses season CSV exports (`Place, Day, Time, Swim`) and converts them to weekly recurring events.
- Applies per-pool location metadata and Google Calendar color IDs from your config.
- Supports dry-run previews by default; add `--confirm` to push real events.
- Tags created events with a private extended property (`source=pool-schedule`) to make clean-up targeting easy.
- Companion command for deleting events in a date window, with optional filters and series deletion.

## Prerequisites

- Node.js 20+ (uses ES modules and `ts-node` loaders).
- `npm install` to pull dependencies.
- A `credentials.json` OAuth Desktop Client file from Google Cloud in the project root. The first authorized run will generate `token.json`.

## Configuration

Copy `data/config.example.json` to `data/config.json` and fill in details:

```json
{
  "timezone": "America/Toronto",
  "calendarId": "your-id@group.calendar.google.com",
  "locations": {
    "Gellert": {
      "address": "10241 Eighth Line, Georgetown, ON",
      "colorId": "9"
    },
    "Acton": {
      "address": "69 Acton Blvd., Acton, ON",
      "colorId": "5"
    }
  }
}
```

- `timezone`: Olson/IANA timezone for event times (e.g., `America/Toronto`).
- `calendarId`: Destination Google Calendar ID.
- `locations`: Optional overrides per pool/venue for display address and color.

## CSV Expectations

- The file must include `Start,<date>` and `End,<date>` rows before the schedule.
- Schedule header row: `Place,Day,Time,Swim`.
- Rows may leave `Place`/`Day` blank to repeat the previous value.
- `Time` is a single range string (e.g., `6:30-7:30am`); the parser handles simple ranges and AM/PM.

See `data/swim-schedule-2025-fall.csv` for an example layout.

## Usage

### Create events

```sh
npm run create -- \
  --config ./data/config.json \
  --schedule ./data/swim-schedule-2025-fall.csv \
  --confirm
```

- Omit `--confirm` for a dry-run preview. The script logs each planned recurrence without making API calls.

### Clear events

```sh
npm run clear -- \
  --calendarId your-calendar-id@group.calendar.google.com \
  --start 2025-09-02 \
  --end 2025-12-21 \
  --confirm \
  --privateKey source=pool-schedule
```

Key options:

- `--confirm`: Required to actually delete; otherwise the script only reports matches.
- `--deleteSeries`: Remove entire recurring series when any instance overlaps the window.
- `--privateKey key=value`: Filter to events tagged by the importer (`source=pool-schedule`).

Both scripts accept `--help` for the full CLI reference.

## Google Calendar Color IDs

| ID  | Name (approx)     | Example |
| --- | ----------------- | ------- |
| 1   | Blue (default)    | 🟦      |
| 2   | Green             | 🟩      |
| 3   | Purple            | 🟪      |
| 4   | Red               | 🟥      |
| 5   | Yellow            | 🟨      |
| 6   | Orange            | 🟧      |
| 7   | Cyan ("Peacock")  | 🩵       |
| 8   | Gray ("Graphite") | ⬜      |
| 9   | Bold Blue         | 🔵      |
| 10  | Bold Green        | 🟢      |
| 11  | Bold Red          | 🔴      |

Use these IDs in `config.json` to align calendar colors with pool expectations.
