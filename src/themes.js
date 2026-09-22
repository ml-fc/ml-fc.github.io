const CACHE_KEY = "mlfc_weekly_epl_theme_v1";
const THEME_PROPERTIES = [
  "--bg", "--panel", "--panel-2", "--primary", "--primary-2", "--accent", "--accent-2",
  "--line", "--focus", "--theme-card-tint", "--theme-card-line", "--weekly-crest",
];

export const EPL_THEMES = [
  { teamId: 42, slug: "arsenal", name: "Arsenal", aliases: ["Arsenal FC"], background: "#160a14", panel: "#29111d", panel2: "#3a1625", primary: "#b50924", primary2: "#870719", accent: "#e9b949", accent2: "#2b6cb0", cardTint: "#fff8f8", cardLine: "#e7c8ce" },
  { teamId: 66, slug: "aston-villa", name: "Aston Villa", aliases: ["Aston Villa FC"], background: "#160a18", panel: "#2b1025", panel2: "#3b1732", primary: "#670e36", primary2: "#4b0926", accent: "#78b9da", accent2: "#f4c542", cardTint: "#fbf7fa", cardLine: "#ddc7d4" },
  { teamId: 35, slug: "bournemouth", name: "AFC Bournemouth", aliases: ["Bournemouth"], background: "#120d10", panel: "#25171b", panel2: "#342025", primary: "#a91419", primary2: "#7e0d12", accent: "#ef3b3f", accent2: "#c7a65a", cardTint: "#fff8f8", cardLine: "#e5cbcc" },
  { teamId: 55, slug: "brentford", name: "Brentford", aliases: ["Brentford FC"], background: "#130d10", panel: "#27151a", panel2: "#371d23", primary: "#b20c20", primary2: "#850817", accent: "#f0c24b", accent2: "#111111", cardTint: "#fff9f9", cardLine: "#e7cccf" },
  { teamId: 51, slug: "brighton", name: "Brighton & Hove Albion", aliases: ["Brighton", "Brighton and Hove Albion"], background: "#071327", panel: "#0d2341", panel2: "#123156", primary: "#07529a", primary2: "#043b71", accent: "#63b3ed", accent2: "#f6d44a", cardTint: "#f7fbff", cardLine: "#c9dbea" },
  { teamId: 49, slug: "chelsea", name: "Chelsea", aliases: ["Chelsea FC"], background: "#071224", panel: "#0c2342", panel2: "#12315a", primary: "#034694", primary2: "#02346e", accent: "#dba111", accent2: "#4bb7e8", cardTint: "#f7faff", cardLine: "#c8d5e7" },
  { teamId: 52, slug: "crystal-palace", name: "Crystal Palace", aliases: ["Crystal Palace FC"], background: "#091327", panel: "#101f3d", panel2: "#172c51", primary: "#174387", primary2: "#102f61", accent: "#e33142", accent2: "#62a7dc", cardTint: "#f8faff", cardLine: "#cbd6e7" },
  { teamId: 134, slug: "coventry-city", name: "Coventry City", aliases: ["Coventry City FC", "Coventry"], background: "#071827", panel: "#0e2a40", panel2: "#133a57", primary: "#15547a", primary2: "#0d3c59", accent: "#69b3e7", accent2: "#e8f5ff", cardTint: "#f6fbfe", cardLine: "#c6ddea" },
  { teamId: 45, slug: "everton", name: "Everton", aliases: ["Everton FC"], background: "#071126", panel: "#0c2143", panel2: "#12305d", primary: "#003399", primary2: "#00236b", accent: "#5ca9e6", accent2: "#ffffff", cardTint: "#f7faff", cardLine: "#c6d3e8" },
  { teamId: 36, slug: "fulham", name: "Fulham", aliases: ["Fulham FC"], background: "#111113", panel: "#202025", panel2: "#303036", primary: "#242428", primary2: "#111114", accent: "#d71920", accent2: "#c8a55a", cardTint: "#fbfbfb", cardLine: "#d7d7da" },
  { teamId: 64, slug: "hull-city", name: "Hull City", aliases: ["Hull City AFC", "Hull"], background: "#15110a", panel: "#292116", panel2: "#3a2d1b", primary: "#332814", primary2: "#1d170c", accent: "#f5a12d", accent2: "#ffffff", cardTint: "#fffaf2", cardLine: "#e6d3b8" },
  { teamId: 57, slug: "ipswich-town", name: "Ipswich Town", aliases: ["Ipswich Town FC", "Ipswich"], background: "#071329", panel: "#0c2447", panel2: "#12335f", primary: "#124a9c", primary2: "#0c3470", accent: "#e63232", accent2: "#f5d15f", cardTint: "#f7faff", cardLine: "#c9d6e8" },
  { teamId: 63, slug: "leeds-united", name: "Leeds United", aliases: ["Leeds United FC", "Leeds"], background: "#07142a", panel: "#0d264a", panel2: "#143762", primary: "#17478b", primary2: "#103365", accent: "#f4cf27", accent2: "#ffffff", cardTint: "#f9fbff", cardLine: "#cbd7e7" },
  { teamId: 40, slug: "liverpool", name: "Liverpool", aliases: ["Liverpool FC"], background: "#160b11", panel: "#2a111b", panel2: "#3b1724", primary: "#a80b25", primary2: "#790719", accent: "#31b6a2", accent2: "#e5c066", cardTint: "#fff8f9", cardLine: "#e5c8ce" },
  { teamId: 50, slug: "manchester-city", name: "Manchester City", aliases: ["Manchester City FC", "Man City"], background: "#071627", panel: "#0d2942", panel2: "#133b59", primary: "#1c4b73", primary2: "#123752", accent: "#6cabdd", accent2: "#e4bd55", cardTint: "#f5fbff", cardLine: "#c5dce9" },
  { teamId: 33, slug: "manchester-united", name: "Manchester United", aliases: ["Manchester United FC", "Man United", "Man Utd"], background: "#160c0d", panel: "#2a1717", panel2: "#3b2020", primary: "#a70b12", primary2: "#79080d", accent: "#f0c75e", accent2: "#111111", cardTint: "#fff8f8", cardLine: "#e7caca" },
  { teamId: 34, slug: "newcastle-united", name: "Newcastle United", aliases: ["Newcastle United FC", "Newcastle"], background: "#0f1114", panel: "#202329", panel2: "#30343b", primary: "#252a31", primary2: "#14171b", accent: "#55b6d9", accent2: "#d8b75c", cardTint: "#fafafa", cardLine: "#d5d7da" },
  { teamId: 65, slug: "nottingham-forest", name: "Nottingham Forest", aliases: ["Nottingham Forest FC", "Nott'm Forest"], background: "#150b0e", panel: "#291419", panel2: "#3a1c23", primary: "#ae1024", primary2: "#7e0b19", accent: "#ef5261", accent2: "#e9c45b", cardTint: "#fff8f9", cardLine: "#e5c9ce" },
  { teamId: 746, slug: "sunderland", name: "Sunderland", aliases: ["Sunderland AFC"], background: "#140d10", panel: "#29171b", panel2: "#3a2025", primary: "#ac1022", primary2: "#7d0b18", accent: "#e83c4c", accent2: "#d3b45e", cardTint: "#fff8f9", cardLine: "#e6cacf" },
  { teamId: 47, slug: "tottenham-hotspur", name: "Tottenham Hotspur", aliases: ["Tottenham Hotspur FC", "Tottenham", "Spurs"], background: "#071126", panel: "#0d203e", panel2: "#142e54", primary: "#132257", primary2: "#0b1538", accent: "#77b7dc", accent2: "#d7b95d", cardTint: "#f8faff", cardLine: "#cbd5e4" },
].map((theme) => ({ ...theme, crest: `./assets/epl-2026-27/${theme.slug}.png` }));

function normalized(value) {
  return String(value || "").toLowerCase().replace(/&/g, "and").replace(/\b(fc|afc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveEplTheme(selection = {}) {
  const teamId = Number(selection.teamId || 0);
  const slug = String(selection.themeSlug || "").trim().toLowerCase();
  const name = normalized(selection.teamName);
  return EPL_THEMES.find((theme) => teamId === theme.teamId || slug === theme.slug ||
    [theme.name, ...(theme.aliases || [])].some((candidate) => normalized(candidate) === name)) || null;
}

function clearWeeklyTheme() {
  const root = document.documentElement;
  THEME_PROPERTIES.forEach((property) => root.style.removeProperty(property));
  delete document.body.dataset.weeklyTheme;
  delete document.body.dataset.weeklyTeam;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#07111e");
  document.querySelectorAll(".nextMatch__themeName").forEach((element) => { element.textContent = ""; });
  document.querySelectorAll(".nextMatch__themeMark").forEach((element) => { element.removeAttribute("aria-label"); });
}

export function applyWeeklyTheme(payload) {
  clearWeeklyTheme();
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ enabled: Boolean(payload?.enabled), theme: payload?.theme || null })); } catch {}
  if (!payload?.enabled || !payload?.theme) return null;
  const theme = resolveEplTheme(payload.theme);
  if (!theme) return null;
  const root = document.documentElement;
  const values = {
    "--bg": theme.background, "--panel": theme.panel, "--panel-2": theme.panel2,
    "--primary": theme.primary, "--primary-2": theme.primary2, "--accent": theme.accent,
    "--accent-2": theme.accent2, "--line": `${theme.accent}35`, "--focus": `0 0 0 3px ${theme.accent}66`,
    "--theme-card-tint": theme.cardTint, "--theme-card-line": theme.cardLine,
    "--weekly-crest": `url("${theme.crest}")`,
  };
  Object.entries(values).forEach(([property, value]) => root.style.setProperty(property, value));
  document.body.dataset.weeklyTheme = theme.slug;
  document.body.dataset.weeklyTeam = theme.name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.background);
  document.querySelectorAll(".nextMatch__themeName").forEach((element) => { element.textContent = theme.name; });
  document.querySelectorAll(".nextMatch__themeMark").forEach((element) => {
    element.setAttribute("aria-label", `Team of the Week: ${theme.name}`);
  });
  return theme;
}

export async function initWeeklyTheme(loadCurrentTheme) {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached) applyWeeklyTheme(cached);
  } catch {}

  try {
    const current = await loadCurrentTheme();
    if (!current?.ok) return;
    const payload = { enabled: Boolean(current.enabled), theme: current.theme || null };
    applyWeeklyTheme(payload);
  } catch {}
}
