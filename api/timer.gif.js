const PImage = require("pureimage");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const BRASLIA_OFFSET_MINUTES = Number(process.env.BRT_OFFSET_MINUTES ?? -180); // America/Sao_Paulo
const BR_TIMEZONE_LABEL = "BRT";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_SECOND = 1000;

const WIDTH = 820;
const HEIGHT = 320;

function toBrasiliaDate(dateUtc = new Date()) {
  return new Date(dateUtc.getTime() + BRASLIA_OFFSET_MINUTES * MS_PER_MINUTE);
}

function isSameDay(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function getNextTuesdayAt19Br(nowBr) {
  const dayOfWeek = nowBr.getUTCDay(); // 0..6, Tue = 2
  const daysToTuesday = (2 - dayOfWeek + 7) % 7;

  const targetBr = new Date(
    Date.UTC(
      nowBr.getUTCFullYear(),
      nowBr.getUTCMonth(),
      nowBr.getUTCDate(),
      19,
      0,
      0,
      0
    )
  );

  if (daysToTuesday === 0 && nowBr.getUTCHours() >= 19) {
    targetBr.setUTCDate(targetBr.getUTCDate() + 7);
  } else {
    targetBr.setUTCDate(targetBr.getUTCDate() + daysToTuesday);
  }

  return targetBr;
}

function getStateLabel(nowBr, targetBr) {
  const tomorrowBr = new Date(nowBr.getTime() + MS_PER_DAY);

  if (isSameDay(targetBr, nowBr)) {
    return "HOJE";
  }

  if (isSameDay(targetBr, tomorrowBr)) {
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

function roundedRect(ctx, x, y, width, height, radius, fillStyle) {
  ctx.fillStyle = fillStyle;
  ctx.fillRect(x, y, width, height);
}

function drawTile(ctx, label, value, x, y) {
  roundedRect(ctx, x, y, 176, 120, 16, "#13213a");

  ctx.fillStyle = "#94a3b8";
  ctx.font = "18px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x + 88, y + 36);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 52px Arial, sans-serif";
  ctx.fillText(value, x + 88, y + 92);
}

function formatDateLabel(targetBr) {
  const weekday = targetBr.toLocaleDateString("pt-BR", { weekday: "long" });
  const date = targetBr.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
  return `${weekday}, ${date}`;
}

function toUtcFromBrasilia(targetBr) {
  return targetBr.getTime() - BRASLIA_OFFSET_MINUTES * MS_PER_MINUTE;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

module.exports = async (req, res) => {
  try {
    const nowUtc = new Date();
    const nowBr = toBrasiliaDate(nowUtc);
    const targetBr = getNextTuesdayAt19Br(nowBr);
    const state = getStateLabel(nowBr, targetBr);
    const targetUtc = toUtcFromBrasilia(targetBr);
    const totalMs = targetUtc - nowUtc.getTime();
    const remaining = toRemainingParts(totalMs);
    const dateLabel = formatDateLabel(targetBr);

    const canvas = PImage.make(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    background.addColorStop(0, "#020617");
    background.addColorStop(1, "#0f172a");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    roundedRect(ctx, 24, 30, WIDTH - 48, HEIGHT - 60, 24, "#0f1c38");

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 28px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Timer 1", 64, 86);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 38px Arial, sans-serif";
    ctx.fillText(`Contagem para terça às 19h ${BR_TIMEZONE_LABEL}`, 64, 135);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "26px Arial, sans-serif";
    ctx.fillText(`Próximo evento: ${dateLabel} às 19:00`, 64, 175);

    const tileStartX = 64;
    const tileStartY = 205;
    drawTile(ctx, "DIAS", pad2(remaining.days), tileStartX, tileStartY);
    drawTile(
      ctx,
      "HORAS",
      `${pad2(remaining.hours)}`,
      tileStartX + 196,
      tileStartY
    );
    drawTile(
      ctx,
      "MINUTOS",
      `${pad2(remaining.minutes)}`,
      tileStartX + 392,
      tileStartY
    );
    drawTile(
      ctx,
      "SEGUNDOS",
      `${pad2(remaining.seconds)}`,
      tileStartX + 588,
      tileStartY
    );

    ctx.fillStyle = "#cbd5e1";
    ctx.font = "24px Arial, sans-serif";
    ctx.fillText(`Estado: ${state}`, 64, 280);
    ctx.fillText("Atualiza no próximo refresh do e-mail (ou novo acesso ao pixel)", 64, 308);

    const { data: rgba } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    const encoder = GIFEncoder();
    encoder.writeFrame(indexed, WIDTH, HEIGHT, {
      palette,
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
    res.status(500).json({
      error: "Falha ao gerar timer.gif",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};
