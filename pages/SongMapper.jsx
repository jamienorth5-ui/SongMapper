import { useState, useEffect, useRef } from "react";

const COLORS = [
  "#ff7f7f", "#ffcc00", "#33cc33", "#3399ff", "#9b59b6", "#ff1493", "#f39c12",
  "#1abc9c", "#2ecc71", "#e74c3c", "#34495e", "#f1c40f", "#d35400", "#16a085",
  "#27ae60", "#2980b9", "#8e44ad", "#ecf0f1", "#95a5a6", "#7f8c8d"
];

function getYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    return u.searchParams.get("v");
  } catch { return null; }
}
function isYouTubeUrl(url) { return !!getYouTubeId(url); }
function isSoundCloudUrl(url) { try { return new URL(url).hostname.includes("soundcloud.com"); } catch { return false; } }
function isBandcampUrl(url) { try { return new URL(url).hostname.includes("bandcamp.com"); } catch { return false; } }

function btnStyle(bg, color, disabled = false) {
  return {
    padding: "7px 0", width: "100%",
    background: disabled ? "#2a2a2a" : bg,
    color: disabled ? "#555" : color,
    border: "none", borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: "bold", fontSize: 12,
    marginBottom: 6,
  };
}

function formatTime(t) {
  if (!t || isNaN(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Confirmation Modal ──────────────────────────────────────────────────────
function ConfirmModal({ message, onNewMap, onContinue }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
    }}>
      <div style={{
        background: "#1e1e1e", border: "1px solid #444", borderRadius: 8,
        padding: "28px 32px", maxWidth: 360, textAlign: "center", color: "#eee"
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🎵</div>
        <p style={{ fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={onNewMap} style={{
            padding: "8px 20px", background: "#00d4ff", color: "#000",
            border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold", fontSize: 13
          }}>Start New Map</button>
          <button onClick={onContinue} style={{
            padding: "8px 20px", background: "#333", color: "#eee",
            border: "1px solid #555", borderRadius: 4, cursor: "pointer", fontSize: 13
          }}>Keep Current Map</button>
        </div>
      </div>
    </div>
  );
}

export default function SongMapper() {
  const playerRef = useRef(null);
  const timelineRef = useRef(null);
  const rafRef = useRef(null);
  const isDraggingRef = useRef(false);
  const fileInputRef = useRef(null);
  const localPlayerRef = useRef(null);
  const bandcampTimerRef = useRef(null);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);

  const [urlInput, setUrlInput] = useState("");
  const [pendingLoad, setPendingLoad] = useState(null); // { type, payload } — waiting for confirm
  const [mediaType, setMediaType] = useState(null);
  const [activeUrl, setActiveUrl] = useState(""); // the URL actually loaded (for embeds)
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [sections, setSections] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [labelValue, setLabelValue] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [localFileUrl, setLocalFileUrl] = useState(null);
  const [localFileName, setLocalFileName] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [embedDurationInput, setEmbedDurationInput] = useState("");
  const [notes, setNotes] = useState({});
  // Bandcamp manual timer
  const [bcTime, setBcTime] = useState(0);
  const [bcPlaying, setBcPlaying] = useState(false);

  // ── History ──────────────────────────────────────────────────────────────
  function pushHistory(newSections) {
    const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
    trimmed.push(newSections);
    if (trimmed.length > 20) trimmed.shift();
    historyRef.current = trimmed;
    historyIndexRef.current = trimmed.length - 1;
    setSections(newSections);
  }
  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    setSections(historyRef.current[historyIndexRef.current]);
    setSelectedId(null);
  }
  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    setSections(historyRef.current[historyIndexRef.current]);
    setSelectedId(null);
  }
  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  // Global Ctrl+Z
  useEffect(() => {
    function onKey(e) {
      const inNote = document.activeElement?.dataset?.notearea === "true";
      if (inNote) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // ── YouTube API ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.YT && window.YT.Player) { initYTPlayer(); return; }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = initYTPlayer;
    return () => { window.onYouTubeIframeAPIReady = null; };
  }, []);

  function initYTPlayer() {
    playerRef.current = new window.YT.Player("yt-player", {
      height: "360", width: "640",
      events: {
        onReady: () => {},
        onStateChange: (e) => {
          if (e.data === window.YT.PlayerState.PLAYING) startTracking();
          else stopTracking();
        }
      }
    });
  }
  function startTracking() {
    const tick = () => {
      if (playerRef.current?.getCurrentTime) {
        setCurrentTime(playerRef.current.getCurrentTime());
        setDuration(playerRef.current.getDuration() || 0);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }
  function stopTracking() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  // ── Bandcamp manual timer ─────────────────────────────────────────────────
  useEffect(() => {
    if (bcPlaying && mediaType === "bandcamp") {
      bandcampTimerRef.current = setInterval(() => {
        setBcTime(t => {
          const next = t + 0.5;
          setCurrentTime(next);
          return next >= duration ? (setBcPlaying(false), duration) : next;
        });
      }, 500);
    } else {
      clearInterval(bandcampTimerRef.current);
    }
    return () => clearInterval(bandcampTimerRef.current);
  }, [bcPlaying, mediaType, duration]);

  // ── Init sections ─────────────────────────────────────────────────────────
  function initSections(d) {
    const initial = [{ id: Date.now(), time: 0, endTime: d, color: COLORS[0], label: "Section 1" }];
    historyRef.current = [initial];
    historyIndexRef.current = 0;
    setSections(initial);
    setNotes({});
    setSelectedId(null);
  }

  // ── "New map?" gate ───────────────────────────────────────────────────────
  const hasActiveMap = videoLoaded && sections.length > 0;

  function requestLoad(type, payload) {
    if (hasActiveMap) {
      setPendingLoad({ type, payload });
    } else {
      executeLoad(type, payload);
    }
  }

  function executeLoad(type, payload) {
    setPendingLoad(null);
    stopTracking();
    clearInterval(bandcampTimerRef.current);
    setBcTime(0); setBcPlaying(false);
    setVideoLoaded(false); setDuration(0); setCurrentTime(0);
    setSections([]); setNotes({}); setSelectedId(null);
    setEmbedDurationInput("");
    setIsPlaying(false);

    if (type === "youtube") {
      const { id, url } = payload;
      setMediaType("youtube");
      setLocalFileUrl(null);
      setActiveUrl(url);
      if (!playerRef.current?.loadVideoById) return alert("YouTube player not ready, try again.");
      playerRef.current.loadVideoById(id);
      const wait = setInterval(() => {
        const d = playerRef.current.getDuration();
        if (d && d > 0) { setDuration(d); setVideoLoaded(true); initSections(d); clearInterval(wait); }
      }, 500);
    } else if (type === "soundcloud") {
      setMediaType("soundcloud");
      setLocalFileUrl(null);
      setActiveUrl(payload.url);
    } else if (type === "bandcamp") {
      setMediaType("bandcamp");
      setLocalFileUrl(null);
      setActiveUrl(payload.url);
    } else if (type === "local") {
      const { file } = payload;
      const url = URL.createObjectURL(file);
      setLocalFileUrl(url);
      setLocalFileName(file.name);
      setMediaType("local");
    }
  }

  // ── Load from URL ─────────────────────────────────────────────────────────
  function loadFromUrl(url) {
    url = url.trim();
    if (!url) return;
    if (isYouTubeUrl(url)) {
      requestLoad("youtube", { id: getYouTubeId(url), url });
    } else if (isSoundCloudUrl(url)) {
      requestLoad("soundcloud", { url });
    } else if (isBandcampUrl(url)) {
      requestLoad("bandcamp", { url });
    } else {
      alert("Please enter a valid YouTube, SoundCloud, or Bandcamp URL.");
    }
  }

  // ── Local file ────────────────────────────────────────────────────────────
  function handleLocalMetadata() {
    const el = localPlayerRef.current;
    if (!el) return;
    const d = el.duration;
    if (d && d > 0) { setDuration(d); setVideoLoaded(true); initSections(d); }
  }
  function handleLocalTimeUpdate() {
    if (localPlayerRef.current) setCurrentTime(localPlayerRef.current.currentTime);
  }
  function handleLocalEnded() { setIsPlaying(false); }
  function togglePlayPause() {
    const el = localPlayerRef.current;
    if (!el) return;
    if (el.paused) { el.play(); setIsPlaying(true); }
    else { el.pause(); setIsPlaying(false); }
  }
  function handleVolumeChange(v) {
    setVolume(v);
    if (localPlayerRef.current) localPlayerRef.current.volume = v;
  }

  // ── Embed duration setter ─────────────────────────────────────────────────
  function handleEmbedDurationSet() {
    const raw = embedDurationInput.trim();
    const parts = raw.split(":").map(Number);
    let secs = 0;
    if (parts.length === 2) secs = parts[0] * 60 + parts[1];
    else if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else secs = parseFloat(raw);
    if (secs > 0) { setDuration(secs); setVideoLoaded(true); initSections(secs); }
  }

  // ── Drop handler ──────────────────────────────────────────────────────────
  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) requestLoad("local", { file });
    else {
      const url = e.dataTransfer.getData("text/plain");
      if (url) { setUrlInput(url); loadFromUrl(url); }
    }
  }

  // ── Section actions ───────────────────────────────────────────────────────
  function addSection() {
    if (!videoLoaded || duration === 0) return;
    let t = currentTime;
    if (mediaType === "youtube" && playerRef.current?.getCurrentTime)
      t = playerRef.current.getCurrentTime();
    const sorted = [...sections].sort((a, b) => a.time - b.time);
    const idx = sorted.findIndex(s => t > s.time && t < s.endTime);
    if (idx === -1) return;
    const containing = sorted[idx];
    const oldEnd = containing.endTime;
    const newId = Date.now();
    const updated = sorted.map((s, i) => i === idx ? { ...s, endTime: t } : s);
    updated.push({ id: newId, time: t, endTime: oldEnd, color: selectedColor, label: "New Section" });
    updated.sort((a, b) => a.time - b.time);
    pushHistory(updated);
  }

  function deleteSection() {
    if (selectedId === null) return;
    const sorted = [...sections].sort((a, b) => a.time - b.time);
    const idx = sorted.findIndex(s => s.id === selectedId);
    if (idx === -1 || sorted.length === 1) return;
    let updated;
    if (idx > 0) {
      updated = sorted.map((s, i) => i === idx - 1 ? { ...s, endTime: sorted[idx].endTime } : s)
                      .filter((_, i) => i !== idx);
    } else {
      updated = sorted.map((s, i) => i === 1 ? { ...s, time: sorted[0].time } : s)
                      .filter((_, i) => i !== 0);
    }
    setNotes(prev => { const n = { ...prev }; delete n[selectedId]; return n; });
    setSelectedId(null);
    pushHistory(updated);
  }

  function changeSelectedColor(color) {
    setSelectedColor(color);
    if (selectedId !== null)
      pushHistory(sections.map(s => s.id === selectedId ? { ...s, color } : s));
  }

  // ── Timeline interaction ──────────────────────────────────────────────────
  function handleTimelineClick(e) {
    if (isDraggingRef.current) return;
    setSelectedId(null);
    if (!videoLoaded || duration === 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seekTo(Math.max(0, Math.min(duration, pct * duration)));
  }

  function seekTo(t) {
    if (mediaType === "youtube" && playerRef.current) playerRef.current.seekTo(t, true);
    else if (mediaType === "local" && localPlayerRef.current) localPlayerRef.current.currentTime = t;
    else if (mediaType === "bandcamp") setBcTime(t);
    setCurrentTime(t);
  }

  function handlePlayheadMouseDown(e) {
    e.stopPropagation();
    isDraggingRef.current = true;
    const rect = timelineRef.current.getBoundingClientRect();
    const onMove = (ev) => {
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      seekTo(pct * duration);
    };
    const onUp = () => {
      setTimeout(() => { isDraggingRef.current = false; }, 50);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleBoundaryDrag(e, idx) {
    e.stopPropagation();
    const rect = timelineRef.current.getBoundingClientRect();
    const sorted = [...sections].sort((a, b) => a.time - b.time);
    const left = sorted[idx], right = sorted[idx + 1];
    if (!left || !right) return;
    let latestSections = sections;
    const onMove = (ev) => {
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const nb = Math.max(left.time + 0.5, Math.min(right.endTime - 0.5, pct * duration));
      latestSections = sorted.map(s => {
        if (s.id === left.id) return { ...s, endTime: nb };
        if (s.id === right.id) return { ...s, time: nb };
        return s;
      });
      setSections(latestSections);
    };
    const onUp = () => {
      pushHistory(latestSections);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function commitLabel() {
    if (editingLabelId === null) return;
    pushHistory(sections.map(s => s.id === editingLabelId ? { ...s, label: labelValue } : s));
    setEditingLabelId(null);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const sorted = [...sections].sort((a, b) => a.time - b.time);
  const selectedSection = selectedId != null ? sections.find(s => s.id === selectedId) : null;
  const PLAYER_W = 640;
  const needsDuration = (mediaType === "soundcloud" || mediaType === "bandcamp") && !videoLoaded;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", background: "#111", color: "#eee", minHeight: "100vh", fontFamily: "Arial, sans-serif" }}>

      {/* Confirm modal */}
      {pendingLoad && (
        <ConfirmModal
          message="You have an active map. Do you want to start a fresh map for the new track, or keep your current sections and notes?"
          onNewMap={() => executeLoad(pendingLoad.type, pendingLoad.payload)}
          onContinue={() => setPendingLoad(null)}
        />
      )}

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <div style={{ width: 200, minWidth: 200, background: "#1a1a1a", borderRight: "1px solid #333", padding: "20px 14px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>

        <h1 style={{ color: "#00d4ff", margin: 0, fontSize: 16, lineHeight: 1.3 }}>🎵 Song Mapper</h1>

        {/* Load */}
        <div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1 }}>Load Audio / Video</div>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current.click()}
            style={{
              border: `2px dashed ${dragOver ? "#00d4ff" : "#444"}`,
              borderRadius: 6, padding: "10px 8px", textAlign: "center",
              cursor: "pointer", marginBottom: 8, transition: "border-color 0.2s",
              background: dragOver ? "#1e2d35" : "transparent"
            }}
          >
            <div style={{ fontSize: 22, marginBottom: 4 }}>📂</div>
            <div style={{ fontSize: 10, color: "#888" }}>Drop file or click to browse</div>
          </div>
          <input ref={fileInputRef} type="file" accept="audio/*,video/*" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) requestLoad("local", { file: e.target.files[0] }); }} />
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="YouTube / SoundCloud / Bandcamp URL"
            onKeyDown={e => e.key === "Enter" && loadFromUrl(urlInput)}
            style={{
              width: "100%", padding: "5px 8px", boxSizing: "border-box",
              background: "#222", color: "#eee", border: "1px solid #444", borderRadius: 4,
              fontSize: 11, marginBottom: 6
            }}
          />
          <button onClick={() => loadFromUrl(urlInput)} style={btnStyle("#00d4ff", "#000")}>Load URL</button>

          {/* Add / Delete moved here */}
          <div style={{ borderTop: "1px solid #333", marginTop: 4, paddingTop: 10 }}>
            <button onClick={addSection} disabled={!videoLoaded} style={btnStyle("#00d4ff", "#000", !videoLoaded)}>➕ Add Section</button>
            <button onClick={deleteSection} disabled={selectedId === null} style={btnStyle("#e74c3c", "#fff", selectedId === null)}>🗑 Delete Section</button>
          </div>
        </div>

        {/* Colour Picker */}
        <div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1 }}>Section Colour</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {COLORS.map(c => (
              <div key={c} onClick={() => changeSelectedColor(c)} style={{
                width: 24, height: 24, borderRadius: 4, backgroundColor: c, cursor: "pointer",
                border: selectedColor === c ? "2px solid #00d4ff" : "2px solid transparent"
              }} />
            ))}
          </div>
        </div>

        {/* Chosen colour + Undo/Redo */}
        <div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1 }}>Chosen Colour</div>
          <div style={{ width: "100%", height: 32, borderRadius: 4, backgroundColor: selectedColor, border: "1px solid #555", marginBottom: 10 }} />
          <button onClick={undo} disabled={!canUndo} style={btnStyle("#555", "#eee", !canUndo)}>↩ Undo</button>
          <button onClick={redo} disabled={!canRedo} style={btnStyle("#555", "#eee", !canRedo)}>↪ Redo</button>
        </div>
      </div>

      {/* ── CENTRE ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 16px" }}>

        {/* Player area — one player at a time */}
        <div style={{ width: PLAYER_W, background: "#000", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>

          {/* YouTube — always in DOM so the API iframe target exists; hidden when not active */}
          <div id="yt-player" style={{ display: mediaType === "youtube" ? "block" : "none", width: PLAYER_W, height: 360 }} />

          {/* Local file */}
          {mediaType === "local" && localFileUrl && (() => {
            const isVideo = /\.(mp4|webm|ogv|mov)$/i.test(localFileName);
            return (
              <div style={{ background: "#000" }}>
                {isVideo ? (
                  <video ref={localPlayerRef} src={localFileUrl}
                    onLoadedMetadata={handleLocalMetadata}
                    onTimeUpdate={handleLocalTimeUpdate}
                    onEnded={handleLocalEnded}
                    style={{ width: PLAYER_W, maxHeight: 320, display: "block" }} />
                ) : (
                  <div style={{ width: PLAYER_W, height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#111" }}>
                    <audio ref={localPlayerRef} src={localFileUrl}
                      onLoadedMetadata={handleLocalMetadata}
                      onTimeUpdate={handleLocalTimeUpdate}
                      onEnded={handleLocalEnded} />
                    <div style={{ fontSize: 36, marginBottom: 8 }}>🎵</div>
                    <div style={{ fontSize: 11, color: "#aaa", maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{localFileName}</div>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#181818", borderTop: "1px solid #333" }}>
                  <button onClick={togglePlayPause} style={{ background: "#00d4ff", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, color: "#000", fontWeight: "bold", flexShrink: 0 }}>
                    {isPlaying ? "⏸" : "▶"}
                  </button>
                  <span style={{ fontSize: 11, color: "#aaa", flexShrink: 0 }}>{formatTime(currentTime)} / {formatTime(duration)}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                    <span style={{ fontSize: 12 }}>🔊</span>
                    <input type="range" min={0} max={1} step={0.01} value={volume}
                      onChange={e => handleVolumeChange(parseFloat(e.target.value))}
                      style={{ width: 80, accentColor: "#00d4ff" }} />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* SoundCloud embed */}
          {mediaType === "soundcloud" && (
            <div>
              <iframe width={PLAYER_W} height={166} scrolling="no" frameBorder="no" allow="autoplay"
                src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(activeUrl)}&color=%2300d4ff&auto_play=false&show_artwork=true`}
                style={{ display: "block" }} />
              {/* Duration setter — always shown until set */}
              <div style={{ padding: "10px 12px", background: "#181818", borderTop: "1px solid #333", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {videoLoaded
                  ? <span style={{ fontSize: 11, color: "#888" }}>Duration set: {formatTime(duration)} · Scrub the timeline to set position</span>
                  : <>
                      <span style={{ fontSize: 11, color: "#f39c12" }}>⚠ Enter track duration to enable timeline:</span>
                      <input value={embedDurationInput} onChange={e => setEmbedDurationInput(e.target.value)}
                        placeholder="m:ss or seconds"
                        onKeyDown={e => e.key === "Enter" && handleEmbedDurationSet()}
                        style={{ width: 110, padding: "3px 6px", background: "#222", color: "#eee", border: "1px solid #444", borderRadius: 4, fontSize: 11 }} />
                      <button onClick={handleEmbedDurationSet}
                        style={{ padding: "3px 10px", background: "#00d4ff", color: "#000", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: "bold" }}>Set</button>
                    </>
                }
              </div>
            </div>
          )}

          {/* Bandcamp embed + manual controls */}
          {mediaType === "bandcamp" && (
            <div>
              <iframe style={{ border: 0, width: PLAYER_W, height: 120, display: "block" }}
                src={`https://bandcamp.com/EmbeddedPlayer/size=large/bgcol=111111/linkcol=00d4ff/transparent=true/?url=${encodeURIComponent(activeUrl)}`}
                seamless />
              {/* Duration setter */}
              <div style={{ padding: "10px 12px", background: "#181818", borderTop: "1px solid #333", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {!videoLoaded
                  ? <>
                      <span style={{ fontSize: 11, color: "#f39c12" }}>⚠ Enter track duration to enable timeline:</span>
                      <input value={embedDurationInput} onChange={e => setEmbedDurationInput(e.target.value)}
                        placeholder="m:ss or seconds"
                        onKeyDown={e => e.key === "Enter" && handleEmbedDurationSet()}
                        style={{ width: 110, padding: "3px 6px", background: "#222", color: "#eee", border: "1px solid #444", borderRadius: 4, fontSize: 11 }} />
                      <button onClick={handleEmbedDurationSet}
                        style={{ padding: "3px 10px", background: "#00d4ff", color: "#000", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: "bold" }}>Set</button>
                    </>
                  : <>
                      {/* Play/pause + timecode for Bandcamp */}
                      <button onClick={() => setBcPlaying(p => !p)}
                        style={{ background: "#00d4ff", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, color: "#000", fontWeight: "bold", flexShrink: 0 }}>
                        {bcPlaying ? "⏸" : "▶"}
                      </button>
                      <span style={{ fontSize: 11, color: "#aaa" }}>{formatTime(bcTime)} / {formatTime(duration)}</span>
                      <span style={{ fontSize: 10, color: "#666", marginLeft: "auto" }}>Play in embed above · timer tracks position</span>
                    </>
                }
              </div>
            </div>
          )}

          {/* Empty state */}
          {!mediaType && (
            <div style={{ width: PLAYER_W, height: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#555", gap: 8 }}>
              <div style={{ fontSize: 40 }}>🎵</div>
              <div style={{ fontSize: 13 }}>Load a file or URL to get started</div>
            </div>
          )}
        </div>

        {/* Time display (YouTube + SoundCloud show it here; local shows in player bar; Bandcamp in control bar) */}
        {duration > 0 && (mediaType === "youtube" || mediaType === "soundcloud") && (
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8, alignSelf: "flex-start" }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        )}

        {/* Timeline */}
        <div
          ref={timelineRef}
          onClick={handleTimelineClick}
          style={{
            position: "relative", width: PLAYER_W, height: 48,
            marginBottom: 4, cursor: videoLoaded ? "crosshair" : "default",
            backgroundColor: "#2c3e50", borderRadius: 4, overflow: "visible"
          }}
        >
          {duration > 0 && sorted.map((sec, i) => {
            const leftPct = (sec.time / duration) * 100;
            const widthPct = ((sec.endTime - sec.time) / duration) * 100;
            const isSelected = sec.id === selectedId;
            return (
              <div key={sec.id}>
                <div
                  onClick={e => { e.stopPropagation(); setSelectedId(sec.id); }}
                  title={sec.label}
                  style={{
                    position: "absolute", top: 0, height: "100%",
                    left: `${leftPct}%`, width: `${widthPct}%`,
                    backgroundColor: sec.color, cursor: "pointer",
                    boxSizing: "border-box",
                    outline: isSelected ? "2px solid #fff" : "none",
                    borderRadius: 2, overflow: "hidden"
                  }}
                >
                  {editingLabelId === sec.id ? (
                    <input autoFocus value={labelValue}
                      onChange={e => setLabelValue(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") commitLabel(); if (e.key === "Escape") setEditingLabelId(null); }}
                      onBlur={commitLabel}
                      onClick={e => e.stopPropagation()}
                      style={{ position: "absolute", left: 2, top: "50%", transform: "translateY(-50%)", width: "90%", fontSize: 10, background: "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid #fff", borderRadius: 2, padding: "1px 3px" }}
                    />
                  ) : (
                    <span
                      onDoubleClick={e => { e.stopPropagation(); setLabelValue(sec.label); setEditingLabelId(sec.id); }}
                      style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#fff", fontWeight: "bold", textShadow: "0 0 4px #000", whiteSpace: "nowrap", overflow: "hidden", maxWidth: "90%", pointerEvents: "all" }}
                    >{sec.label}</span>
                  )}
                </div>
                {i < sorted.length - 1 && (
                  <div
                    onMouseDown={e => handleBoundaryDrag(e, i)}
                    style={{ position: "absolute", top: 0, left: `calc(${(sec.endTime / duration) * 100}% - 4px)`, width: 8, height: "100%", cursor: "ew-resize", background: "rgba(255,255,255,0.45)", zIndex: 50 }}
                  />
                )}
              </div>
            );
          })}

          {/* Playhead */}
          {duration > 0 && <>
            <div style={{ position: "absolute", top: 0, left: `${playheadPct}%`, width: 2, height: "100%", background: "white", transform: "translateX(-1px)", zIndex: 100, pointerEvents: "none" }} />
            <div onMouseDown={handlePlayheadMouseDown} style={{ position: "absolute", top: "100%", left: `${playheadPct}%`, transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: "14px solid white", cursor: "grab", zIndex: 200 }} />
          </>}
        </div>

        {/* Section Notes Tabs */}
        {videoLoaded && sorted.length > 0 && (
          <div style={{ width: PLAYER_W, marginTop: 12 }}>
            <div style={{ display: "flex", gap: 2, marginBottom: 0, flexWrap: "wrap" }}>
              {sorted.map(sec => (
                <div key={sec.id} onClick={() => setSelectedId(sec.id)}
                  style={{
                    padding: "4px 10px", fontSize: 10, fontWeight: "bold",
                    backgroundColor: sec.id === selectedId ? sec.color : "#2a2a2a",
                    color: sec.id === selectedId ? "#fff" : "#999",
                    borderRadius: "4px 4px 0 0", cursor: "pointer",
                    border: sec.id === selectedId ? `2px solid ${sec.color}` : "2px solid #333",
                    borderBottom: "none", maxWidth: 100, whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis"
                  }}
                  title={sec.label}
                >{sec.label}</div>
              ))}
            </div>
            {selectedSection ? (
              <textarea
                key={selectedSection.id}
                data-notearea="true"
                value={notes[selectedSection.id] || ""}
                onChange={e => setNotes(prev => ({ ...prev, [selectedSection.id]: e.target.value }))}
                placeholder={`Notes for "${selectedSection.label}"…`}
                style={{
                  width: "100%", minHeight: 140, boxSizing: "border-box",
                  background: selectedSection.color + "22",
                  border: `2px solid ${selectedSection.color}`,
                  borderRadius: "0 4px 4px 4px",
                  color: "#eee", fontSize: 13, padding: "10px 12px",
                  resize: "vertical", outline: "none", fontFamily: "inherit", lineHeight: 1.6
                }}
              />
            ) : (
              <div style={{ width: "100%", minHeight: 140, boxSizing: "border-box", background: "#1c1c1c", border: "2px solid #333", borderRadius: "0 4px 4px 4px", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 12 }}>
                Click a section on the timeline or a tab above to add notes
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}