const PImage = require("pureimage");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");
const { DateTime } = require("luxon");

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const TARGET_WEEKDAY = 2; // Tuesday in Luxon (1=Mon .. 7=Sun)
const TARGET_HOUR = 19;
const TARGET_MINUTE = 0;
const WIDTH = 820;
const HEIGHT = 320;
const FONT_REGULAR = "TimerRegular";
const FONT_BOLD = "TimerBold";
const TILE_WIDTH = 176;
const TILE_HEIGHT = 104;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const palette = {
  background: "#020617",
  panel: "#0f172a",
  panelLine: "#1f2a4a",
  panelTitle: "#38bdf8",
  title: "#f8fafc",
  subtitle: "#94a3b8",
  tileBg: "#13213a",
  tileText: "#94a3b8",
  tileValue: "#e2e8f0",
  state: "#67e8f9",
  stateBg: "#082f49",
};

const COUNTRY_TO_TZ = {
  BR: "America/Sao_Paulo",
  AR: "America/Argentina/Buenos_Aires",
  BO: "America/La_Paz",
  CL: "America/Santiago",
  CO: "America/Bogota",
  CR: "America/Costa_Rica",
  CU: "America/Havana",
  DO: "America/Santo_Domingo",
  EC: "America/Guayaquil",
  GT: "America/Guatemala",
  HN: "America/Tegucigalpa",
  MX: "America/Mexico_City",
  PE: "America/Lima",
  PY: "America/Asuncion",
  US: "America/New_York",
  CA: "America/Toronto",
  ES: "Europe/Madrid",
  PT: "Europe/Lisbon",
};

let fontsLoaded = false;

function ensureFontsLoaded() {
  if (fontsLoaded) {
    return;
  }

  PImage.registerFont(require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"), FONT_REGULAR).loadSync();
  PImage.registerFont(require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"), FONT_BOLD).loadSync();
  fontsLoaded = true;
}

function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string") {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timeZone.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getHeader(req, names) {
  const headers = req?.headers || {};

  for (const name of names) {
    const value = headers[name] || headers[name.toLowerCase()];

    if (Array.isArray(value)) {
      if (value[0]) return value[0];
      continue;
    }

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getFallbackTimeZoneFromCountry(country) {
  if (!country) {
    return null;
  }

  return COUNTRY_TO_TZ[country.toUpperCase()] || null;
}

function detectTimeZone(req) {
  try {
    const requestUrl = new URL(req.url || "", "https://instructiva-timer.local");
    const tzFromQuery = requestUrl.searchParams.get("tz") || requestUrl.searchParams.get("timezone");

    if (isValidTimeZone(tzFromQuery)) {
      return tzFromQuery;
    }
  } catch {
    // Ignore URL parse issues and continue to header lookup.
  }

  const tzCandidates = [
    "x-vercel-ip-timezone",
    "x-vercel-timezone",
    "x-timezone",
    "x-geo-time-zone",
    "cf-timezone",
  ];

  const detectedFromHeader = getHeader(req, tzCandidates);

  if (isValidTimeZone(detectedFromHeader)) {
    return detectedFromHeader;
  }

  const country = getHeader(req, ["x-vercel-ip-country", "cf-ipcountry", "x-country"]);
  const fromCountry = getFallbackTimeZoneFromCountry(country);

  if (isValidTimeZone(fromCountry)) {
    return fromCountry;
  }

  return DEFAULT_TIMEZONE;
}

function getTimezoneLabel(timeZone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  });

  const parts = formatter.formatToParts(now);
  const tzPart = parts.find((part) => part.type === "timeZoneName");

  return tzPart ? tzPart.value : timeZone;
}

function getNextTuesdayAtTargetTime(nowLocal) {
  let target = nowLocal.set({
    hour: TARGET_HOUR,
    minute: TARGET_MINUTE,
    second: 0,
    millisecond: 0,
  });

  if (nowLocal > target) {
    target = target.plus({ days: 1 });
  }

  if (target.weekday !== TARGET_WEEKDAY) {
    const daysToTuesday = (TARGET_WEEKDAY - target.weekday + 7) % 7;
    target = target.plus({ days: daysToTuesday });
  }

  return target;
}

function getStateLabel(nowLocal, targetLocal) {
  const nowDay = nowLocal.startOf("day");
  const tomorrow = nowLocal.plus({ days: 1 }).startOf("day");
  const targetDay = targetLocal.startOf("day");

  if (nowDay.valueOf() === targetDay.valueOf()) {
    return "HOJE";
  }

  if (tomorrow.valueOf() === targetDay.valueOf()) {
    return "AMANHÃ";
  }

  return "PRÓXIMA TERÇA";
}

function toRemainingParts(totalMs) {
  const remaining = Math.max(0, totalMs);
  const days = Math.floor(remaining / MS_PER_DAY);
  const hours = Math.floor((remaining % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((remaining % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((remaining % MS_PER_MINUTE) / MS_PER_SECOND);

  return { days, hours, minutes, seconds };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function fillRect(ctx, x, y, width, height, fillStyle) {
  ctx.fillStyle = fillStyle;
  ctx.fillRect(x, y, width, height);
}

function drawPanel(ctx) {
  fillRect(ctx, 0, 0, WIDTH, HEIGHT, palette.background);
  fillRect(ctx, 16, 16, WIDTH - 32, HEIGHT - 32, palette.panel);
}

function drawHeader(ctx, stateLabel) {
  ctx.fillStyle = palette.panelTitle;
  ctx.font = `29pt ${FONT_BOLD}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Timer 1", 48, 42);

  ctx.fillStyle = palette.title;
  ctx.font = `36pt ${FONT_BOLD}`;
  ctx.fillText("Contagem para terça às 19h", 48, 78);

  fillRect(ctx, WIDTH - 248, 42, 200, 42, palette.stateBg);
  ctx.fillStyle = palette.state;
  ctx.font = `17pt ${FONT_BOLD}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(stateLabel, WIDTH - 148, 63);
}

function drawMeta(ctx, dateLabel, tzLabel) {
  ctx.fillStyle = palette.subtitle;
  ctx.font = `24pt ${FONT_REGULAR}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`Próximo evento: ${dateLabel} às 19:00`, 48, 128);

  ctx.fillText(`Fuso: ${tzLabel}`, 48, 160);
}

function drawTile(ctx, label, value, x, y) {
  fillRect(ctx, x, y, TILE_WIDTH, TILE_HEIGHT, palette.tileBg);

  ctx.fillStyle = palette.tileText;
  ctx.font = `18pt ${FONT_REGULAR}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 88, y + 30);

  ctx.fillStyle = palette.tileValue;
  ctx.font = `50pt ${FONT_BOLD}`;
  ctx.fillText(value, x + 88, y + 74);
}

module.exports = async (req, res) => {
  try {
    ensureFontsLoaded();

    const timeZone = detectTimeZone(req);
    const now = DateTime.now().setZone(timeZone);
    const target = getNextTuesdayAtTargetTime(now);

    const state = getStateLabel(now, target);

    const totalMs = target.toMillis() - now.toMillis();
    const remaining = toRemainingParts(totalMs);

    const daysLabel = pad2(remaining.days);
    const hoursLabel = pad2(remaining.hours);
    const minutesLabel = pad2(remaining.minutes);
    const secondsLabel = pad2(remaining.seconds);

    const dateLabel = target
      .setLocale("pt-BR")
      .toFormat("cccc, dd/MM");

    const timezoneLabel = getTimezoneLabel(timeZone);

    const canvas = PImage.make(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    drawPanel(ctx);
    drawHeader(ctx, state);
    drawMeta(ctx, dateLabel, timezoneLabel);

    const tileStartX = 48;
    const tileStartY = 198;

    drawTile(ctx, "DIAS", daysLabel, tileStartX, tileStartY);
    drawTile(ctx, "HORAS", hoursLabel, tileStartX + 190, tileStartY);
    drawTile(ctx, "MINUTOS", minutesLabel, tileStartX + 380, tileStartY);
    drawTile(ctx, "SEGUNDOS", secondsLabel, tileStartX + 570, tileStartY);

    const { data: rgba } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const quantizedPalette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, quantizedPalette);

    const encoder = GIFEncoder();
    encoder.writeFrame(indexed, WIDTH, HEIGHT, {
      palette: quantizedPalette,
      delay: 1000,
      repeat: 0,
      transparent: false,
    });
    encoder.finish();

    const buffer = Buffer.from(encoder.bytes());

    res.statusCode = 200;
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Length", String(buffer.length));
    res.end(buffer);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Falha ao gerar timer.gif",
        details: error instanceof Error ? error.message : String(error),
      })
    );
  }
};
