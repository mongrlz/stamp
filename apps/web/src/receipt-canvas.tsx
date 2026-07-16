import { useEffect, useRef } from "react";

const paperTextureUrl = new URL("./assets/thermal-paper-v1.png", import.meta.url).href;

type ReceiptTone = "blue" | "green" | "red";

export type ReceiptCanvasProps = {
  ariaLabel: string;
  status: string;
  statusTone?: ReceiptTone;
  title: string;
  teams: [string, string];
  fingerprint: readonly (number | string)[];
  fingerprintLabel?: string;
  legend?: string;
  details?: Array<{ label: string; value: string; accent?: ReceiptTone }>;
  stamp?: string;
  stampTone?: ReceiptTone;
  footer: string;
  barcodeSeed: string;
};

const WIDTH = 700;
const HEIGHT = 1020;
const COLORS = {
  ink: "#181814",
  blue: "#0e42dc",
  green: "#0e7f28",
  red: "#d82b24",
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function fitFont(
  context: CanvasRenderingContext2D,
  text: string,
  family: string,
  weight: number,
  initial: number,
  maxWidth: number,
): number {
  let size = initial;
  while (size > 20) {
    context.font = `${weight} ${size}px ${family}`;
    if (context.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return size;
}

function drawRule(context: CanvasRenderingContext2D, y: number): void {
  context.save();
  context.strokeStyle = "rgba(24, 24, 20, 0.72)";
  context.lineWidth = 2;
  context.setLineDash([11, 8]);
  context.beginPath();
  context.moveTo(58, y);
  context.lineTo(WIDTH - 58, y);
  context.stroke();
  context.restore();
}

function drawBarcode(context: CanvasRenderingContext2D, y: number, seedText: string): void {
  const random = seededRandom(hashSeed(seedText));
  context.save();
  context.fillStyle = COLORS.ink;
  let x = 58;
  while (x < WIDTH - 58) {
    const width = 2 + Math.floor(random() * 7);
    const gap = 2 + Math.floor(random() * 5);
    const height = 64 - Math.floor(random() * 12);
    context.globalAlpha = 0.78 + random() * 0.18;
    context.fillRect(x, y + (64 - height), width, height);
    x += width + gap;
  }
  context.restore();
}

function drawThermalText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  seed: number,
): void {
  const random = seededRandom(seed);
  context.save();
  context.fillStyle = color;
  context.globalAlpha = 0.88;
  context.fillText(text, x, y);
  context.globalAlpha = 0.1;
  for (let pass = 0; pass < 4; pass += 1) {
    context.fillText(text, x + (random() - 0.5) * 1.4, y + (random() - 0.5) * 1.2);
  }
  context.restore();
}

export function ReceiptCanvas({
  ariaLabel,
  status,
  statusTone = "blue",
  title,
  teams,
  fingerprint,
  fingerprintLabel = "YOUR STAMP",
  legend = "P1G · P2G · P1C · P2C",
  details = [],
  stamp,
  stampTone = "green",
  footer,
  barcodeSeed,
}: ReceiptCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderKey = JSON.stringify({ barcodeSeed, details, fingerprint, fingerprintLabel, footer, legend, stamp, stampTone, status, statusTone, teams, title });

  useEffect(() => {
    let active = true;
    const render = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      await document.fonts.ready;
      const paper = await loadImage(paperTextureUrl);
      if (!active) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      canvas.width = WIDTH * 2;
      canvas.height = HEIGHT * 2;
      context.scale(2, 2);
      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = "#f6f0e5";
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.globalAlpha = 0.76;
      context.drawImage(paper, 0, 0, WIDTH, HEIGHT);
      context.globalAlpha = 1;

      const random = seededRandom(hashSeed(barcodeSeed));
      context.save();
      context.globalCompositeOperation = "multiply";
      for (let index = 0; index < 70; index += 1) {
        context.fillStyle = `rgba(92, 68, 37, ${0.012 + random() * 0.022})`;
        context.fillRect(random() * WIDTH, random() * HEIGHT, 1 + random() * 4, 1 + random() * 2);
      }
      context.restore();

      context.globalCompositeOperation = "multiply";
      context.textBaseline = "alphabetic";
      context.textAlign = "left";
      context.font = '700 26px "IBM Plex Mono"';
      drawThermalText(context, "●", 58, 75, COLORS[statusTone], 1);
      drawThermalText(context, status.toUpperCase(), 92, 75, COLORS[statusTone], 2);

      const titleSize = fitFont(context, title, '"Bebas Neue"', 900, 62, WIDTH - 116);
      context.font = `900 ${titleSize}px "Bebas Neue"`;
      drawThermalText(context, title.toUpperCase(), 58, 150, COLORS.ink, 3);
      drawRule(context, 178);

      const teamSize = Math.min(
        fitFont(context, teams[0], '"Bebas Neue"', 900, 54, WIDTH - 116),
        fitFont(context, teams[1], '"Bebas Neue"', 900, 54, WIDTH - 116),
      );
      context.font = `900 ${teamSize}px "Bebas Neue"`;
      drawThermalText(context, teams[0].toUpperCase(), 58, 245, COLORS.ink, 4);
      drawThermalText(context, `— ${teams[1].toUpperCase()}`, 58, 305, COLORS.ink, 5);
      drawRule(context, 334);

      context.font = '600 20px "IBM Plex Mono"';
      context.fillStyle = "rgba(24, 24, 20, 0.74)";
      context.fillText(fingerprintLabel.toUpperCase(), 58, 380);
      const fingerprintText = fingerprint.join("  ·  ");
      const fingerprintSize = fitFont(context, fingerprintText, '"IBM Plex Mono"', 700, 58, WIDTH - 116);
      context.font = `700 ${fingerprintSize}px "IBM Plex Mono"`;
      drawThermalText(context, fingerprintText, 58, 447, COLORS.green, 6);
      context.font = '500 17px "IBM Plex Mono"';
      context.fillStyle = "rgba(24, 24, 20, 0.7)";
      context.fillText(legend, 58, 480);
      drawRule(context, 512);

      let y = 557;
      details.slice(0, 4).forEach((detail, index) => {
        context.font = '500 17px "IBM Plex Mono"';
        context.fillStyle = "rgba(24, 24, 20, 0.68)";
        context.fillText(detail.label.toUpperCase(), 58, y);
        const valueSize = fitFont(context, detail.value, '"IBM Plex Mono"', 700, 29, WIDTH - 116);
        context.font = `700 ${valueSize}px "IBM Plex Mono"`;
        drawThermalText(context, detail.value, 58, y + 37, detail.accent ? COLORS[detail.accent] : COLORS.ink, 10 + index);
        y += 86;
      });

      if (stamp) {
        const stampY = Math.min(Math.max(y + 8, 680), 812);
        context.save();
        context.translate(WIDTH / 2, stampY);
        context.rotate(-0.045);
        const stampSize = fitFont(context, stamp, '"Bebas Neue"', 900, 52, WIDTH - 150);
        context.font = `900 ${stampSize}px "Bebas Neue"`;
        const measurement = context.measureText(stamp.toUpperCase());
        const boxWidth = measurement.width + 50;
        context.strokeStyle = COLORS[stampTone];
        context.fillStyle = COLORS[stampTone];
        context.globalAlpha = 0.86;
        context.lineWidth = 5;
        context.strokeRect(-boxWidth / 2, -48, boxWidth, 72);
        context.lineWidth = 2;
        context.strokeRect(-boxWidth / 2 + 9, -39, boxWidth - 18, 54);
        context.textAlign = "center";
        context.fillText(stamp.toUpperCase(), 0, 10);
        context.restore();
      }

      drawBarcode(context, 875, barcodeSeed);
      context.font = '600 16px "IBM Plex Mono"';
      context.textAlign = "center";
      context.fillStyle = "rgba(24, 24, 20, 0.76)";
      context.fillText(footer.toUpperCase(), WIDTH / 2, 974);
      context.globalCompositeOperation = "source-over";
    };

    void render();
    return () => { active = false; };
  }, [renderKey]);

  const transcript = [
    status,
    title,
    `${teams[0]} versus ${teams[1]}`,
    `${fingerprintLabel}: ${fingerprint.join(", ")}`,
    ...details.map(({ label, value }) => `${label}: ${value}`),
    stamp ?? "",
    footer,
  ].filter(Boolean).join(". ");

  return (
    <article aria-label={ariaLabel} className="receipt receipt--canvas">
      <canvas aria-hidden="true" className="receipt-canvas" ref={canvasRef} />
      <span className="sr-only">{transcript}</span>
    </article>
  );
}
