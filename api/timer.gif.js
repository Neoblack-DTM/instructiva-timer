const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const opentype = require("opentype.js");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");
const { DateTime } = require("luxon");

const EVENT_TIMEZONE = "America/Sao_Paulo";
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

const FONT_REGULAR = loadFont("Montserrat_400Regular.ttf");
const FONT_BOLD = loadFont("Montserrat_700Bold.ttf");
const FONT_BLACK = loadFont("Montserrat_900Black.ttf");

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

function loadFont(filename) {
  const buffer = fs.readFileSync(path.join(__dirname, "fonts", filename));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  return opentype.parse(arrayBuffer);
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

function textPath(text, x, y, fontSize, font, fill, anchor = "start") {
  const width = font.getAdvanceWidth(text, fontSize);
  const startX = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const pathData = font.getPath(text, startX, y, fontSize).toPathData(1);

  return `<path d="${pathData}" fill="${fill}" />`;
}

function createFrameSvg(nowLocal) {
  const target = getNextTuesdayAtTargetTime(nowLocal);
  const state = getStateLabel(nowLocal, target);
  const remaining = toRemainingParts(target.toMillis() - nowLocal.toMillis());
  const dateLabel = `${formatDateLabel(target)} às 19h (Brasília)`;

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
      <rect width="${WIDTH}" height="${HEIGHT}" fill="${palette.page}" />
      <rect x="16" y="16" width="608" height="228" rx="16" fill="${palette.card}" stroke="${palette.border}" stroke-width="1" />
      <rect x="17" y="17" width="502" height="4" fill="${palette.primary}" />
      <rect x="519" y="17" width="88" height="4" fill="${palette.primarySoft}" />

      <rect x="440" y="38" width="152" height="34" rx="17" fill="${palette.cardSoft}" stroke="${palette.border}" stroke-width="1" />
      ${textPath(chipText, 516, 60, 13, FONT_BOLD, palette.primary, "middle")}

      ${textPath("A aula começa em", 48, 72, 36, FONT_BLACK, palette.text)}
      ${textPath(dateLabel, 48, 110, 17, FONT_REGULAR, palette.textSoft)}

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
    ${textPath(label, centerX, y + 28, 11, FONT_BOLD, palette.primary, "middle")}
    ${textPath(value, centerX, y + 66, 41, FONT_BLACK, palette.text, "middle")}
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
    const now = DateTime.now().setZone(EVENT_TIMEZONE).startOf("second");
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
