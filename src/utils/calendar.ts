// ---- Calendar ops -----------------------------------------------------------

import type { calendar_v3 } from "googleapis";
import {
  BYDAY_TO_INDEX,
  firstOccurrenceOnOrAfter,
  localDateTimeString,
  parseYMD,
  tzWallToUTC_ZString,
  type ByDay,
} from "./helpers.js";

export const listEvents = async (calendar: calendar_v3.Calendar, opts: any) => {
  const results = [];
  let pageToken;

  const params: any = {
    calendarId: opts.calendarId,
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    singleEvents: true, // expand recurring instances
    maxResults: 2500,
    orderBy: "startTime",
  };
  if (opts.privateExtendedProperty)
    params.privateExtendedProperty = opts.privateExtendedProperty;

  do {
    const res: any = await calendar.events.list({ ...params, pageToken });
    const items = res.data.items || [];
    results.push(...items);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return results;
};

export const deleteEvent = async (
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string
) => {
  const maxRetries = 5;
  let attempt = 0;
  while (true) {
    try {
      await calendar.events.delete({ calendarId, eventId });
      return;
    } catch (e: any) {
      const status = e?.code || e?.response?.status;
      if (
        attempt < maxRetries &&
        [403, 429, 500, 502, 503, 504].includes(status)
      ) {
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
      } else {
        throw e;
      }
    }
  }
};

// ---------- event creation helpers ----------
export const inferColorId = (place: string, cfg: { places: any }) => {
  const c = cfg.places?.[place]?.colorId;
  return c || "1";
};

export const resolveLocation = (place: string, cfg: any) => {
  return cfg.places?.[place]?.location || cfg.location || "";
};

export const makePrivateKey = (
  rule: any,
  byDay: any,
  seasonStart: string,
  seasonEnd: string
) => {
  return `${rule.summary}-${byDay}-${rule.startTime}-${rule.endTime}-${seasonStart}-${seasonEnd}`;
};

export const buildEventObject = (
  cfg: any,
  rule: any,
  byDay: ByDay,
  place: string
) => {
  const tz = cfg.timezone;
  const { startDate, endDate } = rule.season;
  const [sH, sM] = rule.startTime.split(":").map(Number);
  const [eH, eM] = rule.endTime.split(":").map(Number);

  const loc = resolveLocation(place, cfg);
  const colorId = inferColorId(place, cfg);

  const first = firstOccurrenceOnOrAfter(startDate, BYDAY_TO_INDEX[byDay]);
  const startDT = localDateTimeString(first.y, first.m, first.d, sH, sM, 0);
  const endDT = localDateTimeString(first.y, first.m, first.d, eH, eM, 0);

  const { y: ey, m: em, d: ed } = parseYMD(endDate);
  const untilZ = tzWallToUTC_ZString(
    { year: ey, month: em, day: ed, hour: 23, minute: 59, second: 59 },
    tz
  );

  const event = {
    summary: rule.summary,
    description: rule.description || "",
    location: loc,
    colorId,
    start: { dateTime: startDT, timeZone: tz },
    end: { dateTime: endDT, timeZone: tz },
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${byDay};UNTIL=${untilZ}`],
    extendedProperties: {
      private: {
        source: "pool-schedule",
        key: makePrivateKey(rule, byDay, startDate, endDate),
      },
    },
    _preview: { place, byDay, startDate: startDT, endDate: endDT, untilZ },
  };
  return event;
};

export const createRecurringEvent = async (
  calendar: any,
  cfg: any,
  rule: any,
  byDay: any,
  place: string,
  dryRun: boolean
) => {
  const event = buildEventObject(cfg, rule, byDay, place);

  if (dryRun) {
    const p = event._preview;
    console.log(
      `[DRY-RUN] ${event.summary} | ${place} | BYDAY=${byDay} | ` +
        `${event.start.dateTime} → ${event.end.dateTime} (${event.start.timeZone}) | ` +
        `location="${event.location}" colorId=${event.colorId} | ${event.recurrence[0]}`
    );
    return;
  }

  await calendar.events.insert({
    calendarId: cfg.calendarId,
    requestBody: event,
  });
  console.log(
    `Created: ${event.summary} | ${place} | ${byDay} ${rule.startTime}-${rule.endTime} | color=${event.colorId}`
  );
};
