import * as fs from "node:fs";

// ---- Helpers ----------------------------------------------------------------
type PartKey = Extract<keyof Intl.DateTimeFormatPartTypesRegistry, string>;
type DateParts = Partial<Record<PartKey, string>>;

// Convert YYYY-MM-DD as "local midnight" in a given IANA timezone to RFC3339 UTC.
// Works without extra deps by using Intl to get the local parts, then building a Date.
export const isoLocalStart = (dateStr: string, tz: any) => {
  const d = new Date(`${dateStr}T00:00:00`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt
    .formatToParts(d)
    .reduce((o, p) => ((o[p.type] = p.value), o), {} as DateParts);
  // This Date is in local wall time, interpreted by host tz. Adjust to UTC string.
  const local = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  );
  return new Date(
    local.getTime() - local.getTimezoneOffset() * 60000
  ).toISOString();
};

export const readJSONSync = (p: string) => {
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

export const writeJSONSync = (p: string, obj: any) => {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
};

export const parsePrivateFilter = (str?: string) => {
  if (!str) return null;
  const eq = str.indexOf("=");
  if (eq === -1) throw new Error("--privateKey must be key=value");
  const key = str.slice(0, eq).trim();
  const val = str.slice(eq + 1).trim();
  if (!key || !val) throw new Error("--privateKey must be key=value");
  return `${key}=${val}`;
};

export const pad2 = (n: number) => {
  return String(n).padStart(2, "0");
};

export const parseDateLoose = (s: string) => {
  const d = new Date(s);
  if (isNaN(d as any)) throw new Error(`Could not parse date: "${s}"`);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
};

export const parseYMD = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d } as { y: number; m: number; d: number };
};

export const firstOccurrenceOnOrAfter = (
  ymd: string | { y: number; m: number; d: number },
  weekdayIdx: number
) => {
  const { y, m, d } = (typeof ymd === "string" ? parseYMD(ymd) : ymd) as {
    y: number;
    m: number;
    d: number;
  };
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const delta = (weekdayIdx - start.getDay() + 7) % 7;
  const first = new Date(start);
  first.setDate(start.getDate() + delta);
  return {
    y: first.getFullYear(),
    m: first.getMonth() + 1,
    d: first.getDate(),
  };
};

export const localDateTimeString = (
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss = 0
) => {
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
};

export const tzWallToUTC_ZString = (
  {
    year,
    month,
    day,
    hour = 23,
    minute = 59,
    second = 59,
  }: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  },
  tz: string
) => {
  const asDate = new Date(
    `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(
      second
    )}`
  );
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(asDate).map((p) => [p.type, p.value])
  );
  const wallLocal = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  );
  const utc = new Date(
    wallLocal.getTime() - wallLocal.getTimezoneOffset() * 60000
  );
  return `${utc.getUTCFullYear()}${pad2(utc.getUTCMonth() + 1)}${pad2(
    utc.getUTCDate()
  )}T${pad2(utc.getUTCHours())}${pad2(utc.getUTCMinutes())}${pad2(
    utc.getUTCSeconds()
  )}Z`;
};

export const BYDAY: Record<
  | "Sunday"
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday",
  ByDay
> = {
  Sunday: "SU",
  Monday: "MO",
  Tuesday: "TU",
  Wednesday: "WE",
  Thursday: "TH",
  Friday: "FR",
  Saturday: "SA",
} as const;

export const BYDAY_TO_INDEX: Record<
  "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA",
  number
> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

// Define the type of valid day keys
export type ByDay = keyof typeof BYDAY_TO_INDEX;
export type ByDayFull = keyof typeof BYDAY;
