/**
 * Gera PNG de um gráfico de pizza com aparência 3D (elipse inferior + fatias achatadas).
 * Entrada neutra: apenas proporções dos valores informados.
 */

const { Resvg } = require("@resvg/resvg-js");

const COLORS = [
  "#00a0d8",
  "#0055cc",
  "#ffb020",
  "#5c6bc0",
  "#26a69a",
  "#ab47bc",
  "#78909c",
  "#7cb342",
];

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s, max) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

/**
 * @param {{ label: string, value: number }[]} items — valores > 0
 * @returns {Buffer|null}
 */
function renderPieChart3dPng(items) {
  if (!items || items.length === 0) return null;
  const sum = items.reduce((s, i) => s + Math.max(0, Number(i.value) || 0), 0);
  if (sum <= 0) return null;

  const W = 520;
  const H = 400;
  const cx = W / 2;
  const cy = H / 2 - 20;
  const r = Math.min(W, H) * 0.26;
  const squash = 0.58;

  let angle = -Math.PI / 2;
  const slices = items.map((it, idx) => {
    const v = Math.max(0, Number(it.value) || 0);
    const frac = v / sum;
    const a0 = angle;
    const a1 = angle + frac * 2 * Math.PI;
    angle = a1;
    return {
      label: it.label,
      value: v,
      frac,
      a0,
      a1,
      color: COLORS[idx % COLORS.length],
    };
  });

  const depth = r * 0.2;
  const ellipseBottom = `  <ellipse cx="${cx}" cy="${cy + depth}" rx="${r}" ry="${r * squash * 0.88}" fill="rgba(0,0,0,0.1)" stroke="none"/>`;

  let pathTop = "";
  for (const sl of slices) {
    const large = sl.a1 - sl.a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(sl.a0);
    const y0 = cy + r * Math.sin(sl.a0) * squash;
    const x1 = cx + r * Math.cos(sl.a1);
    const y1 = cy + r * Math.sin(sl.a1) * squash;
    pathTop += `  <path d="M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r * squash} 0 ${large} 1 ${x1} ${y1} Z" fill="${sl.color}" stroke="#ffffff" stroke-width="1.5"/>\n`;
  }

  const legendLines = [];
  let legendY = H - 78;
  for (let i = 0; i < slices.length; i++) {
    const sl = slices[i];
    const pct = (100 * sl.frac).toFixed(1);
    const lx = 24 + (i % 2) * 240;
    const ly = legendY + Math.floor(i / 2) * 22;
    legendLines.push(
      `<rect x="${lx}" y="${ly}" width="11" height="11" rx="2" fill="${sl.color}"/>` +
        `<text x="${lx + 18}" y="${ly + 10}" font-size="11" font-family="Segoe UI, Helvetica, Arial, sans-serif" fill="#333">${escapeXml(
          truncate(sl.label, 28)
        )} (${pct}%)</text>`
    );
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="#fafafa"/>
  <text x="${W / 2}" y="26" text-anchor="middle" font-size="13" font-weight="600" fill="#1a1a1a" font-family="Segoe UI, Helvetica, Arial, sans-serif">Distribuição percentual do total recalculado por proposta</text>
  <text x="${W / 2}" y="44" text-anchor="middle" font-size="11" fill="#5c5c5c" font-family="Segoe UI, Helvetica, Arial, sans-serif">Visualização — não classifica nem recomenda fornecedores</text>
  <g transform="translate(0, 10)">
    ${ellipseBottom}
    ${pathTop}
  </g>
  ${legendLines.join("\n  ")}
</svg>`;

  try {
    const resvg = new Resvg(svg, {
      fitTo: {
        mode: "width",
        value: 720,
      },
    });
    const pngData = resvg.render();
    return pngData.asPng();
  } catch (e) {
    console.warn("[pieChart3dPng]", e.message);
    return null;
  }
}

module.exports = { renderPieChart3dPng };
