const root = document.documentElement;
const themeButton = document.querySelector(".theme-toggle");
const savedTheme = localStorage.getItem("caliper-theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
  root.dataset.theme = "dark";
}

themeButton?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";

  if (nextTheme === "dark") {
    root.dataset.theme = "dark";
  } else {
    delete root.dataset.theme;
  }

  localStorage.setItem("caliper-theme", nextTheme);
});

const recordField = document.querySelector("[data-record-field]");

if (recordField && window.matchMedia("(pointer: fine)").matches) {
  const sleeves = [...recordField.querySelectorAll(".record-sleeve")];
  const title = recordField.querySelector(".record-title");
  const artist = recordField.querySelector(".record-artist");
  const number = recordField.querySelector(".record-number");

  const updateLabel = (sleeve) => {
    title.textContent = sleeve.dataset.title;
    artist.textContent = sleeve.dataset.artist;
    number.textContent = `WHITE / NO. ${sleeve.dataset.number}`;
  };

  recordField.addEventListener("pointermove", (event) => {
    sleeves.forEach((sleeve) => {
      const rect = sleeve.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = event.clientX - centerX;
      const deltaY = event.clientY - centerY;
      const distance = Math.hypot(deltaX, deltaY);
      const influence = Math.max(0, 1 - distance / 260);
      const directionX = distance ? -deltaX / distance : 0;
      const directionY = distance ? -deltaY / distance : 0;

      sleeve.style.setProperty("--mx", `${directionX * influence * 16}px`);
      sleeve.style.setProperty("--my", `${directionY * influence * 16}px`);
      sleeve.style.setProperty("--scale", 1 + influence * 0.28);

      if (influence > 0.58) {
        updateLabel(sleeve);
      }
    });
  });

  recordField.addEventListener("pointerleave", () => {
    sleeves.forEach((sleeve) => {
      sleeve.style.setProperty("--mx", "0px");
      sleeve.style.setProperty("--my", "0px");
      sleeve.style.setProperty("--scale", "1");
    });
  });

  sleeves.forEach((sleeve) => {
    sleeve.addEventListener("focus", () => updateLabel(sleeve));
    sleeve.addEventListener("mouseenter", () => updateLabel(sleeve));
  });
}

const spectrumForm = document.querySelector("[data-spectrum-form]");
const spectrumRibbon = document.querySelector("[data-spectrum-ribbon]");
const spectrumSummary = document.querySelector("[data-spectrum-summary]");
const supportedPlaylist = "5188962093";

const playlistIdFromValue = (value) => {
  const match = value.match(/[?&]id=(\d+)/);
  return match?.[1] ?? (value.match(/^\d+$/) ? value : "");
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const colorMetrics = (track) => {
  const color = track.color ?? {};
  const hue = Number(color.hue ?? 0);
  const brightness = clamp(Number(color.brightness ?? 0.5), 0, 1);
  const saturation = clamp(Number(color.saturation ?? 0), 0, 1);
  const whiteness = clamp(Number(color.whiteness ?? 0), 0, 1);
  const darkness = clamp(Number(color.darkness ?? 0), 0, 1);
  const achromatic = clamp(whiteness * 1.25 + (1 - saturation) * 0.35, 0, 1);
  const lightness = clamp((brightness * 0.74) + (whiteness * 0.36) - (darkness * 0.58), 0, 1);

  let temperature = Number(track.color?.temperature ?? 0.5);
  if (saturation > 0.1 && whiteness < 0.52) {
    if (hue >= 185 && hue <= 260) temperature = 0.08 + ((260 - hue) / 75) * 0.1;
    else if (hue >= 150 && hue < 185) temperature = 0.22;
    else if (hue >= 85 && hue < 150) temperature = 0.34;
    else if (hue >= 50 && hue < 85) temperature = 0.62;
    else if (hue >= 25 && hue < 50) temperature = 0.8;
    else if (hue < 25 || hue >= 340) temperature = 0.94;
    else if (hue >= 260 && hue < 340) temperature = 0.14 + ((hue - 260) / 80) * 0.28;
  }

  temperature = clamp((temperature * (1 - achromatic * 0.82)) + (0.5 * achromatic * 0.82), 0, 1);

  let chromaSide = 0;
  if (hue >= 70 && hue <= 180) chromaSide = -1;
  else if (hue >= 260 && hue <= 340) chromaSide = 1;
  else if (hue > 180 && hue < 260) chromaSide = -0.35;
  else if (hue < 40 || hue >= 340) chromaSide = 0.35;

  const fallbackSide = Number(track.number ?? track.id ?? 0) % 2 === 0 ? -1 : 1;
  const side = Math.abs(chromaSide) > 0.2 ? chromaSide : fallbackSide * 0.26;
  const peripheral = clamp((darkness * 0.72 + (1 - lightness) * 0.38) * (1 - whiteness * 0.72), 0, 1);
  const axisAffinity = 1 - clamp(Math.abs(temperature - 0.5) * 1.24 + peripheral * 0.48, 0, 1);

  return { temperature, brightness, saturation, whiteness, darkness, lightness, side, peripheral, axisAffinity };
};

const targetPointFor = (track, gridSize) => {
  const metrics = colorMetrics(track);
  const diagonal = metrics.temperature * gridSize;
  const drift = metrics.side * metrics.peripheral * gridSize * 0.34;
  return {
    x: clamp(diagonal + drift, 0, gridSize),
    y: clamp(diagonal - drift, 0, gridSize),
  };
};

const chooseLargeTracks = (tracks, count) => {
  const ordered = [...tracks].sort((a, b) => {
    const aMetrics = colorMetrics(a);
    const bMetrics = colorMetrics(b);
    return bMetrics.axisAffinity - aMetrics.axisAffinity || aMetrics.temperature - bMetrics.temperature;
  });
  const chosen = new Set();
  const bins = new Set();

  for (const track of ordered) {
    const bin = Math.floor(colorMetrics(track).temperature * count);
    const nearbyBins = [bin, bin - 1, bin + 1].filter((item) => item >= 0 && item < count);
    if (nearbyBins.some((item) => !bins.has(item))) {
      const targetBin = nearbyBins.find((item) => !bins.has(item));
      bins.add(targetBin);
      chosen.add(track.id);
    }
    if (chosen.size === count) break;
  }

  for (const track of ordered) {
    if (chosen.size === count) break;
    chosen.add(track.id);
  }

  return chosen;
};

const buildPackedCollage = (tracks) => {
  const gridSize = 12;
  const largeCount = 15;
  const occupied = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));
  const placements = [];
  const largeIds = chooseLargeTracks(tracks, largeCount);
  const largeTracks = tracks.filter((track) => largeIds.has(track.id));
  const smallTracks = tracks.filter((track) => !largeIds.has(track.id));

  const canPlace = (x, y, size) => {
    if (x + size > gridSize || y + size > gridSize) return false;
    for (let row = y; row < y + size; row += 1) {
      for (let col = x; col < x + size; col += 1) {
        if (occupied[row][col]) return false;
      }
    }
    return true;
  };

  const place = (track, x, y, size) => {
    for (let row = y; row < y + size; row += 1) {
      for (let col = x; col < x + size; col += 1) {
        occupied[row][col] = true;
      }
    }
    placements.push({ track, x, y, size });
  };

  const diagonalPenalty = (x, y, size, metrics) => {
    const centerX = x + size / 2;
    const centerY = y + size / 2;
    const distanceFromMainAxis = Math.abs(centerX - centerY) / gridSize;
    return distanceFromMainAxis * (0.92 + metrics.axisAffinity * 1.4);
  };

  largeTracks
    .sort((a, b) => colorMetrics(a).temperature - colorMetrics(b).temperature)
    .forEach((track) => {
      const metrics = colorMetrics(track);
      const target = targetPointFor(track, gridSize);
      const candidates = [];
      for (let y = 0; y < gridSize - 1; y += 1) {
        for (let x = 0; x < gridSize - 1; x += 1) {
          if (!canPlace(x, y, 2)) continue;
          const centerX = x + 0.5;
          const centerY = y + 0.5;
          candidates.push({
            x,
            y,
            distance: Math.hypot(centerX - target.x, centerY - target.y) + diagonalPenalty(x, y, 2, metrics),
          });
        }
      }
      const best = candidates.sort((a, b) => a.distance - b.distance)[0];
      if (best) place(track, best.x, best.y, 2);
    });

  smallTracks
    .map((track) => ({
      track,
      metrics: colorMetrics(track),
    }))
    .sort((a, b) => a.metrics.temperature - b.metrics.temperature || b.metrics.peripheral - a.metrics.peripheral)
    .forEach(({ track, metrics }) => {
      const target = targetPointFor(track, gridSize);
      const candidates = [];
      for (let y = 0; y < gridSize; y += 1) {
        for (let x = 0; x < gridSize; x += 1) {
          if (!canPlace(x, y, 1)) continue;
          candidates.push({
            x,
            y,
            distance: Math.hypot(x + 0.5 - target.x, y + 0.5 - target.y) + diagonalPenalty(x, y, 1, metrics) * 0.28,
          });
        }
      }
      const best = candidates.sort((a, b) => a.distance - b.distance)[0];
      if (best) place(track, best.x, best.y, 1);
    });

  return { gridSize, placements: placements.sort((a, b) => a.y - b.y || a.x - b.x) };
};

const renderSpectrum = async (event) => {
  event?.preventDefault();
  if (!spectrumRibbon || !spectrumSummary || !spectrumForm) return;

  const input = spectrumForm.querySelector("input");
  const playlistId = playlistIdFromValue(input.value.trim());

  if (playlistId !== supportedPlaylist) {
    spectrumSummary.innerHTML = `
      <span>STATIC PROTOTYPE</span>
      <p>Generate data first.</p>
    `;
    spectrumRibbon.innerHTML = "";
    return;
  }

  spectrumSummary.innerHTML = `
    <span>LOADING SPECTRUM</span>
    <p>Reading cover colors.</p>
  `;

  const response = await fetch("data/playlist-spectrum.json", { cache: "no-store" });
  const data = await response.json();
  const tracks = data.tracks ?? [];
  const families = tracks.reduce((acc, track) => {
    const family = track.color?.family ?? "unknown";
    acc[family] = (acc[family] ?? 0) + 1;
    return acc;
  }, {});

  spectrumSummary.innerHTML = `
    <span>${tracks.length} COVERS / COOL TO WARM</span>
    <p>Packed square / ${Object.entries(families).map(([key, value]) => `${key} ${value}`).join(" / ")}</p>
  `;

  const collage = buildPackedCollage(tracks);
  spectrumRibbon.style.setProperty("--grid-size", collage.gridSize);
  spectrumRibbon.innerHTML = collage.placements.map(({ track, x, y, size }) => {
    return `
      <figure class="spectrum-tile spectrum-tile-${size}"
         style="grid-column: ${x + 1} / span ${size}; grid-row: ${y + 1} / span ${size};"
         aria-label="${track.title} - ${track.artist}">
        <img src="${track.cover}" alt="${track.title} cover" loading="lazy">
      </figure>
    `;
  }).join("");
};

spectrumForm?.addEventListener("submit", renderSpectrum);
if (spectrumForm) {
  renderSpectrum();
}
