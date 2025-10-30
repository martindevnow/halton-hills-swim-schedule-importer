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

export type PoolLocationConfig = {
  address?: string;
  location?: string;
  colorId?: string | number;
};

export type CalendarConfig = {
  timezone: string;
  calendarId: string;
  locations?: Record<string, PoolLocationConfig>;
  places?: Record<string, PoolLocationConfig>;
  colorId?: string | number;
  location?: string;
  address?: string;
};

type ListEventsOptions = {
  calendarId: string;
  timeMin: string;
  timeMax: string;
  privateExtendedProperty?: string | string[];
};

type ScheduleSeason = {
  startDate: string;
  endDate: string;
};

export type ScheduleRule = {
  summary: string;
  description?: string;
  startTime: string;
  endTime: string;
  byDay: ByDay[];
  season: ScheduleSeason;
  _place: string;
};

type PreviewInfo = {
  place: string;
  byDay: ByDay;
  startDate: string;
  endDate: string;
  untilZ: string;
};

type PreviewEvent = calendar_v3.Schema$Event & { _preview: PreviewInfo };

export const listEvents = async (
  calendar: calendar_v3.Calendar,
  opts: ListEventsOptions
) => {
  const results: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;

  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId: opts.calendarId,
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    singleEvents: true, // expand recurring instances
    maxResults: 2500,
    orderBy: "startTime",
  };
  if (opts.privateExtendedProperty) {
    params.privateExtendedProperty = Array.isArray(opts.privateExtendedProperty)
      ? opts.privateExtendedProperty
      : [opts.privateExtendedProperty];
  }

  do {
    const request: calendar_v3.Params$Resource$Events$List = pageToken
      ? { ...params, pageToken }
      : { ...params };
    const res = await calendar.events.list(request);
    const items = res.data.items ?? [];
    results.push(...items);
    pageToken = res.data.nextPageToken ?? undefined;
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
    } catch (err: unknown) {
      const status = extractStatusCode(err);
      if (
        attempt < maxRetries &&
        status !== undefined &&
        [403, 429, 500, 502, 503, 504].includes(status)
      ) {
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
      } else {
        throw err;
      }
    }
  }
};

// ---------- event creation helpers ----------
const extractStatusCode = (err: unknown): number | undefined => {
  if (!err || typeof err !== "object") return undefined;
  const candidate = err as {
    code?: number;
    response?: { status?: number };
  };
  return candidate.code ?? candidate.response?.status;
};

const placeConfig = (place: string, cfg: CalendarConfig) => {
  return cfg.locations?.[place] ?? cfg.places?.[place] ?? null;
};

export const inferColorId = (place: string, cfg: CalendarConfig) => {
  const raw = placeConfig(place, cfg)?.colorId ?? cfg.colorId;
  if (raw === undefined || raw === null || raw === "") return "1";
  return String(raw);
};

export const resolveLocation = (place: string, cfg: CalendarConfig) => {
  const locCfg = placeConfig(place, cfg);
  return (
    locCfg?.address || locCfg?.location || cfg.location || cfg.address || ""
  );
};

export const makePrivateKey = (
  rule: ScheduleRule,
  byDay: ByDay,
  place: string,
  seasonStart: string,
  seasonEnd: string
) => {
  return `${rule.summary}-${place}-${byDay}-${rule.startTime}-${rule.endTime}-${seasonStart}-${seasonEnd}`;
};

export const buildEventObject = (
  cfg: CalendarConfig,
  rule: ScheduleRule,
  byDay: ByDay,
  place: string
) => {
  const tz = cfg.timezone;
  const { startDate, endDate } = rule.season;
  const [sH, sM] = rule.startTime.split(":").map(Number);
  const [eH, eM] = rule.endTime.split(":").map(Number);
  const loc = resolveLocation(place, cfg);
  const colorId = inferColorId(place, cfg);

  const dayIndex = BYDAY_TO_INDEX[byDay];
  if (dayIndex === undefined)
    throw new Error(`Unsupported BYDAY value: ${byDay}`);

  if (
    sH === undefined ||
    sM === undefined ||
    eH === undefined ||
    eM === undefined
  ) {
    throw new Error(`Invalid time range parsed for ${rule.summary}`);
  }

  const first = firstOccurrenceOnOrAfter(startDate, dayIndex);
  const startDT = localDateTimeString(first.y, first.m, first.d, sH, sM, 0);
  const endDT = localDateTimeString(first.y, first.m, first.d, eH, eM, 0);

  const { y: ey, m: em, d: ed } = parseYMD(endDate);
  const untilZ = tzWallToUTC_ZString(
    { year: ey, month: em, day: ed, hour: 23, minute: 59, second: 59 },
    tz
  );

  const event: PreviewEvent = {
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
        key: makePrivateKey(rule, byDay, place, startDate, endDate),
      },
    },
    _preview: { place, byDay, startDate: startDT, endDate: endDT, untilZ },
  };
  return event;
};

export const createRecurringEvent = async (
  calendar: calendar_v3.Calendar | null,
  cfg: CalendarConfig,
  rule: ScheduleRule,
  byDay: ByDay,
  place: string,
  dryRun: boolean
) => {
  const event = buildEventObject(cfg, rule, byDay, place);

  if (dryRun) {
    const startDT = event.start?.dateTime ?? "(no start)";
    const endDT = event.end?.dateTime ?? "(no end)";
    const tz = event.start?.timeZone ?? cfg.timezone;
    const recurrence = event.recurrence?.[0] ?? "";
    const key = event.extendedProperties?.private?.key ?? "";
    console.log(
      `[DRY-RUN] ${event.summary} | ${place} | BYDAY=${byDay} | ` +
        `${startDT} → ${endDT} (${tz}) | ` +
        `location="${event.location || ""}" colorId=${
          event.colorId || ""
        } | ${recurrence}, key: ${key}`
    );
    return;
  }

  if (!calendar) throw new Error("Calendar client unavailable for inserts.");

  const { _preview, ...requestBody } = event;

  await calendar.events.insert({
    calendarId: cfg.calendarId,
    requestBody: requestBody as calendar_v3.Schema$Event,
  });
  console.log(
    `Created: ${event.summary} | ${place} | ${byDay} ${rule.startTime}-${rule.endTime} | color=${event.colorId}`
  );
};
