import type { PonsPulseMetric, PonsStateResponse } from "@/lib/pons/model";

const WIDTH = 1600;
const HEIGHT = 900;

function metricChange(metric: PonsPulseMetric) {
  if (metric.changePercent === null) return metric.current > 0 && metric.previous === 0 ? "NEW" : "—";
  return `${metric.changePercent > 0 ? "+" : ""}${metric.changePercent}%`;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawGlyph(context: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.lineWidth = 8;
  context.strokeStyle = "#d0a760";
  context.lineCap = "square";
  for (const [x1, y1, x2, y2, x3, y3] of [
    [0, 36, 0, 0, 36, 0], [84, 0, 120, 0, 120, 36],
    [120, 84, 120, 120, 84, 120], [36, 120, 0, 120, 0, 84],
  ]) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.lineTo(x3, y3);
    context.stroke();
  }
  context.strokeStyle = "#a4b579";
  context.lineWidth = 8;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(18, 32);
  context.bezierCurveTo(48, 2, 66, 22, 52, 56);
  context.bezierCurveTo(38, 88, 54, 116, 80, 100);
  context.lineTo(112, 68);
  context.stroke();
  context.fillStyle = "#c36a4b";
  context.beginPath(); context.arc(53, 54, 7, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.arc(47, 88, 7, 0, Math.PI * 2); context.fill();
  context.restore();
}

function drawMetric(context: CanvasRenderingContext2D, x: number, y: number, width: number, label: string, metric: PonsPulseMetric, tone: string) {
  context.fillStyle = "#ffffff0a";
  context.strokeStyle = "#ffffff18";
  context.lineWidth = 1;
  roundedRect(context, x, y, width, 210, 14);
  context.fill(); context.stroke();
  context.fillStyle = tone;
  context.fillRect(x, y, 5, 210);
  context.font = "600 19px 'IBM Plex Mono', monospace";
  context.fillStyle = "#e8e2d370";
  context.fillText(label.toUpperCase(), x + 34, y + 45);
  context.font = "600 76px 'IBM Plex Mono', monospace";
  context.fillStyle = "#e8e2d3";
  context.fillText(new Intl.NumberFormat("en-US").format(metric.current), x + 32, y + 126);
  context.font = "500 20px 'IBM Plex Mono', monospace";
  context.fillStyle = metric.changePercent !== null && metric.changePercent < 0 ? "#c36a4b" : tone;
  context.fillText(`${metricChange(metric)} VS PRIOR · ${metric.previous.toLocaleString()}`, x + 34, y + 174);
}

export async function downloadPulseCard(state: PonsStateResponse) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");

  context.fillStyle = "#171a14";
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.strokeStyle = "#ffffff0a";
  context.lineWidth = 1;
  for (let x = 40; x < WIDTH; x += 56) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, HEIGHT); context.stroke(); }
  for (let y = 40; y < HEIGHT; y += 56) { context.beginPath(); context.moveTo(0, y); context.lineTo(WIDTH, y); context.stroke(); }

  const glow = context.createRadialGradient(1260, 110, 10, 1260, 110, 470);
  glow.addColorStop(0, "#d0a7601c");
  glow.addColorStop(1, "#d0a76000");
  context.fillStyle = glow;
  context.fillRect(760, 0, 840, 600);

  drawGlyph(context, 72, 62, 0.68);
  context.font = "700 28px Arial, sans-serif";
  context.fillStyle = "#e8e2d3";
  context.fillText("MEMETIC STATE", 182, 101);
  context.font = "500 16px 'IBM Plex Mono', monospace";
  context.fillStyle = "#e8e2d355";
  context.fillText("INDEPENDENT PONS ATTENTION INTELLIGENCE", 182, 132);

  const statusTone = state.pulse.status === "verified" ? "#a4b579" : state.pulse.status === "delayed" ? "#c36a4b" : "#899890";
  context.fillStyle = `${statusTone}14`;
  context.strokeStyle = `${statusTone}55`;
  roundedRect(context, 1252, 72, 274, 54, 9);
  context.fill(); context.stroke();
  context.beginPath(); context.arc(1282, 99, 6, 0, Math.PI * 2); context.fillStyle = statusTone; context.fill();
  context.font = "600 17px 'IBM Plex Mono', monospace";
  context.fillText(`${state.pulse.status.toUpperCase()} PULSE`, 1302, 105);

  context.font = "500 18px 'IBM Plex Mono', monospace";
  context.fillStyle = "#c36a4b";
  context.fillText(`PONS STATE / BLOCK #${state.index.latestIndexedBlock.toLocaleString()}`, 74, 236);
  context.font = "400 25px Georgia, serif";
  context.fillStyle = "#e8e2d370";
  context.fillText(`Verified activity across two adjacent ~${state.pulse.approximateMinutes}-minute windows.`, 74, 280);

  const gap = 18;
  const cardWidth = (WIDTH - 148 - gap * 3) / 4;
  drawMetric(context, 74, 334, cardWidth, "Curve trades", state.pulse.trades, "#d0a760");
  drawMetric(context, 74 + (cardWidth + gap), 334, cardWidth, "Distinct actors", state.pulse.uniqueTraders, "#a4b579");
  drawMetric(context, 74 + (cardWidth + gap) * 2, 334, cardWidth, "New launches", state.pulse.launches, "#d0a760");
  drawMetric(context, 74 + (cardWidth + gap) * 3, 334, cardWidth, "Graduations", state.pulse.graduations, "#c36a4b");

  context.strokeStyle = "#ffffff18";
  context.beginPath(); context.moveTo(74, 604); context.lineTo(1526, 604); context.stroke();

  context.font = "600 16px 'IBM Plex Mono', monospace";
  context.fillStyle = "#e8e2d355";
  context.fillText("MOST ACTIVE OBSERVED LAUNCH", 74, 654);
  context.font = "600 38px Arial, sans-serif";
  context.fillStyle = state.pulse.leader ? "#a4b579" : "#e8e2d355";
  context.fillText(state.pulse.leader ? `${state.pulse.leader.tokenSymbol} / ${state.pulse.leader.pairSymbol}` : "PULSE WARMING", 74, 705);
  context.font = "500 18px 'IBM Plex Mono', monospace";
  context.fillStyle = "#e8e2d355";
  context.fillText(state.pulse.leader ? `${state.pulse.leader.recentTrades.toLocaleString()} recent curve trades` : "No leader resolved in this interval", 74, 742);

  context.textAlign = "right";
  context.font = "500 17px 'IBM Plex Mono', monospace";
  context.fillStyle = statusTone;
  context.fillText(state.integrity.pulseReconciled ? "COHORT TOTALS RECONCILED" : "COHORT MISMATCH", 1526, 654);
  context.fillStyle = "#e8e2d355";
  context.fillText(`${state.index.liveLagBlocks.toLocaleString()} BLOCK LAG · ${state.coverage.metadataPercent.toFixed(1)}% IDENTITY COVERAGE`, 1526, 690);
  context.fillText(new Date(state.generatedAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC", 1526, 726);

  context.textAlign = "left";
  context.fillStyle = "#c36a4b";
  context.fillRect(74, 806, 1452, 2);
  context.font = "500 15px 'IBM Plex Mono', monospace";
  context.fillStyle = "#e8e2d355";
  context.fillText("OBSERVED ACTIVITY—NOT ASSET QUALITY, BACKING, OR FINANCIAL MERIT", 74, 850);
  context.textAlign = "right";
  context.fillStyle = "#a4b579";
  context.fillText("memetic-state.z3c4.chatgpt.site", 1526, 850);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG export failed")), "image/png"));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `memetic-state-pons-pulse-block-${state.index.latestIndexedBlock}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
