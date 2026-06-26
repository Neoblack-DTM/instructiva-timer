const PImage = require("pureimage");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");
const { DateTime } = require("luxon");

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const TARGET_WEEKDAY = 2; // Tuesday in Luxon (1=Mon .. 7=Sun)
const TARGET_HOUR = 19;
const TARGET_MINUTE = 0;
const WIDTH = 640;
const HEIGHT = 260;
const ANIMATION_FRAMES = 60;
const FRAME_DELAY_MS = 1000;
const FONT_REGULAR = "MontserratRegular";
const FONT_BOLD = "MontserratBold";
const FONT_BLACK = "MontserratBlack";
const TILE_WIDTH = 132;
const TILE_HEIGHT = 82;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const palette = {
  page: "#000000",
  card: "#111111",
  cardSoft: "#101010",
  muted: "#1b1b1b",
  border: "#222222",
  primary: "#ff490d",
  primarySoft: "#ff7a35",
  text: "#ffffff",
  textSoft: "#cccccc",
  textMuted: "#9d9d9d",
  success: "#20ca61",
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

  PImage.registerFont(
    require.resolve("@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf"),
    FONT_REGULAR
  ).loadSync();
  PImage.registerFont(
    require.resolve("@expo-google-fonts/montserrat/700Bold/Montserrat_700Bold.ttf"),
    FONT_BOLD
  ).loadSync();
  PImage.registerFont(
    require.resolve("@expo-google-fonts/montserrat/900Black/Montserrat_900Black.ttf"),
    FONT_BLACK
  ).loadSync();
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

function fillBorderedRect(ctx, x, y, width, height, fillStyle, borderStyle) {
  fillRect(ctx, x, y, width, height, borderStyle);
  fillRect(ctx, x + 1, y + 1, width - 2, height - 2, fillStyle);
}

function drawPanel(ctx) {
  fillRect(ctx, 0, 0, WIDTH, HEIGHT, palette.page);
  fillBorderedRect(ctx, 16, 16, WIDTH - 32, HEIGHT - 32, palette.card, palette.border);
  fillRect(ctx, 17, 17, WIDTH - 34, 4, palette.primary);
  fillRect(ctx, 520, 17, 87, 4, palette.primarySoft);
}

function drawHeader(ctx, stateLabel) {
  const chipText = stateLabel === "HOJE" ? "É HOJE" : stateLabel === "AMANHÃ" ? "É AMANHÃ" : "PRÓXIMA TERÇA";

  fillBorderedRect(ctx, 440, 38, 152, 34, palette.cardSoft, palette.border);
  ctx.fillStyle = palette.primary;
  ctx.font = `12pt ${FONT_BOLD}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(chipText, 516, 55);

  ctx.fillStyle = palette.text;
  ctx.font = `31pt ${FONT_BLACK}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("A aula começa em", 48, 42);
}

function drawMeta(ctx, dateLabel, tzLabel) {
  ctx.fillStyle = palette.textSoft;
  ctx.font = `15pt ${FONT_REGULAR}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${dateLabel} às 19:00`, 48, 94);

  ctx.fillStyle = palette.textMuted;
  ctx.font = `11pt ${FONT_REGULAR}`;
  ctx.fillText(`Horário local do aluno: ${tzLabel}`, 48, 122);
}

function drawTile(ctx, label, value, x, y) {
  fillBorderedRect(ctx, x, y, TILE_WIDTH, TILE_HEIGHT, palette.muted, palette.border);

  ctx.fillStyle = palette.primary;
  ctx.font = `10pt ${FONT_BOLD}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + TILE_WIDTH / 2, y + 22);

  ctx.fillStyle = palette.text;
  ctx.font = `38pt ${FONT_BLACK}`;
  ctx.fillText(value, x + TILE_WIDTH / 2, y + 58);
}

function drawFrame(nowLocal, timeZone) {
  const target = getNextTuesdayAtTargetTime(nowLocal);
  const state = getStateLabel(nowLocal, target);
  const totalMs = target.toMillis() - nowLocal.toMillis();
  const remaining = toRemainingParts(totalMs);
  const dateLabel = target.setLocale("pt-BR").toFormat("cccc, dd/MM");
  const timezoneLabel = getTimezoneLabel(timeZone);

  const canvas = PImage.make(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  drawPanel(ctx);
  drawHeader(ctx, state);
  drawMeta(ctx, dateLabel, timezoneLabel);

  const tileStartX = 48;
  const tileStartY = 154;
  const tileGap = 16;

  drawTile(ctx, "DIAS", pad2(remaining.days), tileStartX, tileStartY);
  drawTile(ctx, "HORAS", pad2(remaining.hours), tileStartX + (TILE_WIDTH + tileGap), tileStartY);
  drawTile(ctx, "MINUTOS", pad2(remaining.minutes), tileStartX + (TILE_WIDTH + tileGap) * 2, tileStartY);
  drawTile(ctx, "SEGUNDOS", pad2(remaining.seconds), tileStartX + (TILE_WIDTH + tileGap) * 3, tileStartY);

  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
}

module.exports = async (req, res) => {
  try {
    ensureFontsLoaded();

    const timeZone = detectTimeZone(req);
    const now = DateTime.now().setZone(timeZone).startOf("second");
    const encoder = GIFEncoder({ initialCapacity: 1024 * 1024 });
    let quantizedPalette = null;

    for (let frame = 0; frame < ANIMATION_FRAMES; frame += 1) {
      const rgba = drawFrame(now.plus({ seconds: frame }), timeZone);

      if (!quantizedPalette) {
        quantizedPalette = quantize(rgba, 256);
      }

      const indexed = applyPalette(rgba, quantizedPalette);

      encoder.writeFrame(indexed, WIDTH, HEIGHT, {
        palette: frame === 0 ? quantizedPalette : null,
        delay: FRAME_DELAY_MS,
        repeat: 0,
        transparent: false,
        dispose: 1,
      });
    }

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
