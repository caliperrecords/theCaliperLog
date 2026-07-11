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
  const temperature = clamp(Number(color.temperature ?? 0.5), 0, 1);
  const brightness = clamp(Number(color.brightness ?? 0.5), 0, 1);
  const whiteness = clamp(Number(color.whiteness ?? 0), 0, 1);
  const darkness = clamp(Number(color.darkness ?? 0), 0, 1);
  const lightness = clamp((brightness * 0.7) + (whiteness * 0.38) - (darkness * 0.62), 0, 1);
  return { temperature, brightness, whiteness, darkness, lightness };
};

const targetPointFor = (track, gridSize, side = 1) => {
  const metrics = colorMetrics(track);
  const diagonal = metrics.temperature * (gridSize - 1);
  const distance = (1 - metrics.lightness) * 3.1 + metrics.darkness * 1.4;
  return {
    x: clamp(diagonal + side * distance, 0, gridSize - 1),
    y: clamp(diagonal - side * distance, 0, gridSize - 1),
  };
};

const chooseLargeTracks = (tracks, count) => {
  const ordered = [...tracks].sort((a, b) => colorMetrics(a).temperature - colorMetrics(b).temperature);
  const chosen = new Set();

  for (let bin = 0; bin < count; bin += 1) {
    const start = Math.floor((bin * ordered.length) / count);
    const end = Math.max(start + 1, Math.floor(((bin + 1) * ordered.length) / count));
    const candidate = ordered.slice(start, end).sort((a, b) => {
      const aMetrics = colorMetrics(a);
      const bMetrics = colorMetrics(b);
      const aScore = aMetrics.lightness + aMetrics.whiteness * 0.55 - aMetrics.darkness * 0.25;
      const bScore = bMetrics.lightness + bMetrics.whiteness * 0.55 - bMetrics.darkness * 0.25;
      return bScore - aScore;
    })[0];
    if (candidate) chosen.add(candidate.id);
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

  largeTracks
    .sort((a, b) => colorMetrics(a).temperature - colorMetrics(b).temperature)
    .forEach((track, index) => {
      const target = targetPointFor(track, gridSize - 1, index % 2 === 0 ? 1 : -1);
      const candidates = [];
      for (let y = 0; y < gridSize - 1; y += 1) {
        for (let x = 0; x < gridSize - 1; x += 1) {
          if (!canPlace(x, y, 2)) continue;
          const centerX = x + 0.5;
          const centerY = y + 0.5;
          candidates.push({
            x,
            y,
            distance: Math.hypot(centerX - target.x, centerY - target.y) + Math.abs(centerX - centerY) * 0.18,
          });
        }
      }
      const best = candidates.sort((a, b) => a.distance - b.distance)[0];
      if (best) place(track, best.x, best.y, 2);
    });

  smallTracks
    .map((track, index) => ({
      track,
      side: index % 2 === 0 ? 1 : -1,
      metrics: colorMetrics(track),
    }))
    .sort((a, b) => a.metrics.temperature - b.metrics.temperature)
    .forEach(({ track, side }) => {
      const target = targetPointFor(track, gridSize, side);
      const candidates = [];
      for (let y = 0; y < gridSize; y += 1) {
        for (let x = 0; x < gridSize; x += 1) {
          if (!canPlace(x, y, 1)) continue;
          candidates.push({
            x,
            y,
            distance: Math.hypot(x - target.x, y - target.y),
          });
        }
      }
      const best = candidates.sort((a, b) => a.distance - b.distance)[0];
      if (best) place(track, best.x, best.y, 1);
    });

  return { gridSize, placements };
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
