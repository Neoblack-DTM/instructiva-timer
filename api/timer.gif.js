const sharp = require("sharp");
const { pathToFileURL } = require("url");
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
const TILE_WIDTH = 132;
const TILE_HEIGHT = 82;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const FONT_REGULAR_URL = pathToFileURL(
  require.resolve("@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf")
).href;
const FONT_BOLD_URL = pathToFileURL(
  require.resolve("@expo-google-fonts/montserrat/700Bold/Montserrat_700Bold.ttf")
).href;
const FONT_BLACK_URL = pathToFileURL(
  require.resolve("@expo-google-fonts/montserrat/900Black/Montserrat_900Black.ttf")
).href;

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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

  const detectedFromHeader = getHeader(req, [
    "x-vercel-ip-timezone",
    "x-vercel-timezone",
    "x-timezone",
    "x-geo-time-zone",
    "cf-timezone",
  ]);

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

function capitalizeFirst(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDateLabel(target) {
  return capitalizeFirst(target.setLocale("pt-BR").toFormat("cccc, dd/MM"));
}

function formatStateChip(stateLabel) {
  if (stateLabel === "HOJE") return "É HOJE";
  if (stateLabel === "AMANHÃ") return "É AMANHÃ";
  return "PRÓXIMA TERÇA";
}

function createFrameSvg(nowLocal) {
  const target = getNextTuesdayAtTargetTime(nowLocal);
  const state = getStateLabel(nowLocal, target);
  const remaining = toRemainingParts(target.toMillis() - nowLocal.toMillis());
  const dateLabel = `${formatDateLabel(target)} às 19:00`;

  const days = pad2(remaining.days);
  const hours = pad2(remaining.hours);
  const minutes = pad2(remaining.minutes);
  const seconds = pad2(remaining.seconds);
  const chipText = formatStateChip(state);

  const tileY = 150;
  const tileGap = 16;
  const tile1X = 48;
  const tile2X = tile1X + TILE_WIDTH + tileGap;
  const tile3X = tile2X + TILE_WIDTH + tileGap;
  const tile4X = tile3X + TILE_WIDTH + tileGap;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <style>
        @font-face {
          font-family: "MontserratRegular";
          src: url("${FONT_REGULAR_URL}") format("truetype");
          font-weight: 400;
        }
        @font-face {
          font-family: "MontserratBold";
          src: url("${FONT_BOLD_URL}") format("truetype");
          font-weight: 700;
        }
        @font-face {
          font-family: "MontserratBlack";
          src: url("${FONT_BLACK_URL}") format("truetype");
          font-weight: 900;
        }
        text {
          paint-order: normal;
          letter-spacing: 0;
          text-rendering: geometricPrecision;
          dominant-baseline: alphabetic;
        }
      </style>

      <rect width="${WIDTH}" height="${HEIGHT}" fill="${palette.page}" />
      <rect x="16" y="16" width="608" height="228" rx="16" fill="${palette.card}" stroke="${palette.border}" stroke-width="1" />
      <rect x="17" y="17" width="502" height="4" fill="${palette.primary}" />
      <rect x="519" y="17" width="88" height="4" fill="${palette.primarySoft}" />

      <rect x="440" y="38" width="152" height="34" rx="17" fill="${palette.cardSoft}" stroke="${palette.border}" stroke-width="1" />
      <text x="516" y="60" text-anchor="middle" fill="${palette.primary}" font-family="MontserratBold" font-size="13">${escapeXml(chipText)}</text>

      <text x="48" y="72" fill="${palette.text}" font-family="MontserratBlack" font-size="36">A aula começa em</text>
      <text x="48" y="110" fill="${palette.textSoft}" font-family="MontserratRegular" font-size="17">${escapeXml(dateLabel)}</text>

      ${createTileSvg(tile1X, tileY, "DIAS", days)}
      ${createTileSvg(tile2X, tileY, "HORAS", hours)}
      ${createTileSvg(tile3X, tileY, "MINUTOS", minutes)}
      ${createTileSvg(tile4X, tileY, "SEGUNDOS", seconds)}
    </svg>
  `;
}

function createTileSvg(x, y, label, value) {
  const centerX = x + TILE_WIDTH / 2;

  return `
    <rect x="${x}" y="${y}" width="${TILE_WIDTH}" height="${TILE_HEIGHT}" rx="10" fill="${palette.muted}" stroke="${palette.border}" stroke-width="1" />
    <text x="${centerX}" y="${y + 28}" text-anchor="middle" fill="${palette.primary}" font-family="MontserratBold" font-size="11">${escapeXml(label)}</text>
    <text x="${centerX}" y="${y + 66}" text-anchor="middle" fill="${palette.text}" font-family="MontserratBlack" font-size="41">${escapeXml(value)}</text>
  `;
}

async function renderFrame(nowLocal) {
  return sharp(Buffer.from(createFrameSvg(nowLocal)))
    .ensureAlpha()
    .raw()
    .toBuffer();
}

module.exports = async (req, res) => {
  try {
    const timeZone = detectTimeZone(req);
    const now = DateTime.now().setZone(timeZone).startOf("second");
    const encoder = GIFEncoder({ initialCapacity: 1024 * 1024 });
    let quantizedPalette = null;

    for (let frame = 0; frame < ANIMATION_FRAMES; frame += 1) {
      const rgba = await renderFrame(now.plus({ seconds: frame }));

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
