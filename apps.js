// The apps ArrDeck knows. `kind` decides which API the Home dashboard uses and
// which High contrast style the app gets.
//   arr3  = Sonarr / Radarr (API v3)     arr1 = Lidarr / Readarr / Prowlarr (API v1)
//   seerr = Seerr (the old Overseerr) / Jellyseerr       bazarr = Bazarr       web = a plain tab
const APPS = [
  { id: "sonarr",     name: "Sonarr",     url: "http://127.0.0.1:8989", kind: "arr3",   media: "series", on: true,  color: "#35c5f4" },
  { id: "radarr",     name: "Radarr",     url: "http://127.0.0.1:7878", kind: "arr3",   media: "movie",  on: true,  color: "#ffc230" },
  { id: "lidarr",     name: "Lidarr",     url: "http://127.0.0.1:8686", kind: "arr1",   media: "album",  on: true,  color: "#00a65b" },
  { id: "prowlarr",   name: "Prowlarr",   url: "http://127.0.0.1:9696", kind: "arr1",   media: null,     on: true,  color: "#e66001" },
  { id: "seerr",      name: "Seerr",      url: "http://127.0.0.1:5055", kind: "seerr",  media: null,     on: true,  color: "#8b5cf6" },
  { id: "readarr",    name: "Readarr",    url: "http://127.0.0.1:8787", kind: "arr1",   media: "book",   on: false, color: "#8e2222" },
  { id: "bazarr",     name: "Bazarr",     url: "http://127.0.0.1:6767", kind: "bazarr", media: null,     on: false, color: "#a0a0a0" },
  { id: "jellyseerr", name: "Jellyseerr", url: "http://127.0.0.1:5056", kind: "seerr",  media: null,     on: false, color: "#a855f7" },
  // plain tabs (no dashboard): their own pages only
  { id: "cleanuparr", name: "Cleanuparr", url: "http://127.0.0.1:11011", kind: "web",  media: null,     on: false, color: "#2dd4bf" },
  { id: "qbittorrent", name: "qBittorrent", url: "http://127.0.0.1:8080", kind: "web", media: null,     on: false, color: "#3b82f6" },
];

// Which High contrast style file each kind gets (custom "web" pages get none).
const STYLE_FOR_KIND = { arr3: "arr-high-contrast.user.css", arr1: "arr-high-contrast.user.css", seerr: "overseerr-high-contrast.user.css", bazarr: "bazarr-high-contrast.user.css" };

// What you can add yourself (Settings > Apps > Add an app). An extra Sonarr / Radarr / …
// (say, one for anime or 4K) gets the Home dashboard and the High contrast look too;
// "Other web page" is any local web app (qBittorrent, SABnzbd, Tautulli…) as a plain tab.
const TYPES = {
  web:      { label: "Other web page", kind: "web",    media: null },
  sonarr:   { label: "Sonarr",         kind: "arr3",   media: "series" },
  radarr:   { label: "Radarr",         kind: "arr3",   media: "movie" },
  lidarr:   { label: "Lidarr",         kind: "arr1",   media: "album" },
  readarr:  { label: "Readarr",        kind: "arr1",   media: "book" },
  prowlarr: { label: "Prowlarr",       kind: "arr1",   media: null },
  seerr:    { label: "Seerr / Jellyseerr", kind: "seerr", media: null },
  bazarr:   { label: "Bazarr",         kind: "bazarr", media: null },
};
const CUSTOM_COLORS = ["#ff6b9d", "#4dd0e1", "#aed581", "#ffb74d", "#ba68c8", "#90a4ae"];

module.exports = { APPS, STYLE_FOR_KIND, TYPES, CUSTOM_COLORS };
