import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const ACCEPTED = "image/*,video/*,audio/*";
const MAX_MB = 200;

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value * 1000).toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mediaIcon(kind) {
  return kind === "video" ? "▣" : kind === "audio" ? "♫" : "▧";
}

function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [recentScans, setRecentScans] = useState([]);
  const [activeView, setActiveView] = useState("scan");
  const [dragging, setDragging] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchRecentScans();
  }, []);

  async function fetchRecentScans() {
    try {
      const res = await fetch(`${API_BASE}/api/scans?limit=20`);
      if (res.ok) setRecentScans(await res.json());
    } catch {
      // The UI remains usable if the API is temporarily offline.
    }
  }

  function resetScan() {
    setSelectedFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setActiveView("scan");
  }

  function chooseFile(file) {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File is too large. Maximum size is ${MAX_MB} MB.`);
      return;
    }
    const valid =
      file.type.startsWith("image/") ||
      file.type.startsWith("video/") ||
      file.type.startsWith("audio/");
    if (!valid) {
      setError("Unsupported file type. Please choose an image, video, or audio file.");
      return;
    }
    setSelectedFile(file);
    setResult(null);
    setError(null);
    setActiveView("scan");
  }

  function handleFileChange(e) {
    chooseFile(e.target.files?.[0]);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    chooseFile(e.dataTransfer.files?.[0]);
  }

  async function handleAnalyze() {
    if (!selectedFile || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch(`${API_BASE}/api/scan`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${res.status})`);
      }

      const data = await res.json();
      setResult(data);
      await fetchRecentScans();
    } catch (err) {
      setError(err.message || "Analysis failed. Make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  async function shareApp() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Authentix AI",
          text: "AI-powered deepfake detection",
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setError("Link copied to clipboard.");
        setTimeout(() => setError(null), 2200);
      }
    } catch {
      // User cancelled native share.
    }
  }

  const fakeCount = useMemo(
    () => recentScans.filter((scan) => scan.verdict === "fake").length,
    [recentScans]
  );

  const realCount = useMemo(
    () => recentScans.filter((scan) => scan.verdict === "real").length,
    [recentScans]
  );

  const score = result ? Math.round(result.confidencePercent) : null;
  const isFake = result?.verdict === "fake";

  return (
    <div className={`app ${darkMode ? "dark" : "light"}`}>
      <aside className="sidebar">
        <div>
          <div className="brand">
            <div className="brandMark">✦</div>
            <div>
              <div className="brandName">Authentix</div>
              <div className="brandSub">AI Verification</div>
            </div>
          </div>

          <button className="newScan" onClick={resetScan}>
            <span>＋</span> New Scan
          </button>

          <nav className="nav">
            <button
              className={activeView === "scan" ? "navItem active" : "navItem"}
              onClick={() => setActiveView("scan")}
            >
              <span>⌁</span><span>Detection</span>
            </button>
            <button className="navItem" onClick={shareApp}>
              <span>↗</span><span>Share</span>
            </button>
            <button
              className={activeView === "analytics" ? "navItem active" : "navItem"}
              onClick={() => setActiveView("analytics")}
            >
              <span>▥</span><span>Analytics</span>
            </button>
            <button
              className={activeView === "deepfakes" ? "navItem active" : "navItem"}
              onClick={() => setActiveView("deepfakes")}
            >
              <span>◈</span><span>Deepfakes Detected</span>
              {fakeCount > 0 && <b className="navBadge">{fakeCount}</b>}
            </button>
          </nav>
        </div>

        <div className="sidebarBottom">
          <div className="recentTitle">
            <span>Recent scans</span>
            <span className="countPill">{recentScans.length}</span>
          </div>

          {recentScans.length === 0 ? (
            <div className="emptyRecent">
              <div className="emptyIcon">◌</div>
              <span>Your analyzed files will appear here.</span>
            </div>
          ) : (
            <div className="recentList">
              {recentScans.slice(0, 5).map((scan) => (
                <button
                  className="recentItem"
                  key={scan.id}
                  onClick={() => {
                    setResult(scan);
                    setSelectedFile(null);
                    setActiveView("scan");
                  }}
                  title={scan.filename}
                >
                  <span className={`recentIcon ${scan.verdict}`}>
                    {scan.verdict === "fake" ? "!" : "✓"}
                  </span>
                  <span className="recentMeta">
                    <strong>{scan.filename}</strong>
                    <small>{formatDate(scan.createdAt)}</small>
                  </span>
                  <span className={`miniVerdict ${scan.verdict}`}>
                    {Math.round(scan.confidencePercent)}%
                  </span>
                </button>
              ))}
            </div>
          )}

          <button className="helpButton" onClick={() => setShowHelp(true)}>
            <span>?</span> How it works
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Authentix AI</div>
            <h1>
              {activeView === "analytics"
                ? "Analytics"
                : activeView === "deepfakes"
                  ? "Deepfakes Detected"
                  : "Media Verification"}
            </h1>
          </div>

          <div className="topActions">
            <div className="statusPill">
              <span className="statusDot" />
              AI engine ready
            </div>
            <button
              className="themeBtn"
              onClick={() => setDarkMode((value) => !value)}
              aria-label="Toggle theme"
            >
              {darkMode ? "☼" : "☾"}
            </button>
          </div>
        </header>

        {activeView === "analytics" ? (
          <section className="viewPanel">
            <div className="sectionHeading">
              <div>
                <span className="eyebrow">OVERVIEW</span>
                <h2>Detection activity</h2>
              </div>
              <span className="muted">{recentScans.length} total scans</span>
            </div>
            <div className="statsGrid">
              <div className="statCard">
                <span>Total scans</span><strong>{recentScans.length}</strong><small>All analyzed media</small>
              </div>
              <div className="statCard danger">
                <span>Deepfakes</span><strong>{fakeCount}</strong><small>Flagged as likely fake</small>
              </div>
              <div className="statCard success">
                <span>Authentic</span><strong>{realCount}</strong><small>Flagged as likely real</small>
              </div>
              <div className="statCard">
                <span>Detection rate</span>
                <strong>{recentScans.length ? Math.round((fakeCount / recentScans.length) * 100) : 0}%</strong>
                <small>Of analyzed files</small>
              </div>
            </div>
            <div className="activityCard">
              <div>
                <span className="eyebrow">RECENT ACTIVITY</span>
                <h3>Scan history</h3>
              </div>
              {recentScans.length === 0 ? (
                <div className="largeEmpty">Run your first scan to populate analytics.</div>
              ) : (
                <div className="historyTable">
                  {recentScans.map((scan) => (
                    <div className="historyRow" key={scan.id}>
                      <span className={`recentIcon ${scan.verdict}`}>{scan.verdict === "fake" ? "!" : "✓"}</span>
                      <strong>{scan.filename}</strong>
                      <span>{scan.kind}</span>
                      <span>{formatDate(scan.createdAt)}</span>
                      <b className={scan.verdict}>{Math.round(scan.confidencePercent)}%</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : activeView === "deepfakes" ? (
          <section className="viewPanel">
            <div className="sectionHeading">
              <div>
                <span className="eyebrow">FLAGGED MEDIA</span>
                <h2>Potential deepfakes</h2>
              </div>
              <span className="dangerLabel">{fakeCount} flagged</span>
            </div>
            {fakeCount === 0 ? (
              <div className="largeEmpty">
                <div className="emptyIcon big">✓</div>
                No deepfakes have been flagged yet.
              </div>
            ) : (
              <div className="fakeGrid">
                {recentScans.filter((scan) => scan.verdict === "fake").map((scan) => (
                  <button className="fakeCard" key={scan.id} onClick={() => { setResult(scan); setActiveView("scan"); }}>
                    <div className="fakeCardIcon">!</div>
                    <div>
                      <strong>{scan.filename}</strong>
                      <span>{scan.kind} · {formatDate(scan.createdAt)}</span>
                    </div>
                    <b>{Math.round(scan.confidencePercent)}%</b>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="heroGrid">
              <div className="heroCopy">
                <span className="eyebrow">MULTIMODAL DETECTION</span>
                <h2>Verify what you see.<br /><em>Trust what is real.</em></h2>
                <p>
                  Analyze images, videos and audio with AI-powered deepfake detection.
                  Upload a file and get a confidence score in seconds.
                </p>
                <div className="featureRow">
                  <span>✓ Image</span>
                  <span>✓ Video</span>
                  <span>✓ Audio</span>
                  <span>✓ 200 MB max</span>
                </div>
              </div>

              <div className={`resultCard ${result ? (isFake ? "fakeResult" : "realResult") : ""}`}>
                {loading ? (
                  <div className="loadingState">
                    <div className="loader" />
                    <span className="eyebrow">ANALYZING MEDIA</span>
                    <h3>Running detection model…</h3>
                    <p>This can take a little longer for video and audio.</p>
                  </div>
                ) : result ? (
                  <>
                    <div className="resultTop">
                      <span className={`resultStatus ${isFake ? "fake" : "real"}`}>
                        <i>{isFake ? "!" : "✓"}</i>
                        {isFake ? "Potential deepfake" : "Likely authentic"}
                      </span>
                      <span className="mediaTag">{mediaIcon(result.kind)} {result.kind}</span>
                    </div>
                    <div className="scoreRing" style={{ "--score": `${score * 3.6}deg` }}>
                      <div className="scoreInner">
                        <strong>{score}%</strong>
                        <span>confidence</span>
                      </div>
                    </div>
                    <h3>{result.filename}</h3>
                    <p>
                      The model estimates this file is{" "}
                      <b>{isFake ? "likely manipulated" : "likely authentic"}</b>.
                    </p>
                    <div className="resultMeta">
                      <span>Analyzed {formatDate(result.createdAt)}</span>
                      <span>Verdict: <b>{isFake ? "FAKE" : "REAL"}</b></span>
                    </div>
                  </>
                ) : (
                  <div className="emptyResult">
                    <div className="shieldGlow">✦</div>
                    <span className="eyebrow">DETECTION RESULT</span>
                    <h3>Ready when you are</h3>
                    <p>Upload a file below to start your authenticity check.</p>
                  </div>
                )}
              </div>
            </section>

            <section
              className={`uploadPanel ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                onChange={handleFileChange}
                hidden
              />

              <div className="uploadIcon">↑</div>
              <div className="uploadText">
                <h3>{selectedFile ? selectedFile.name : "Drop your media here"}</h3>
                <p>
                  {selectedFile
                    ? `${formatBytes(selectedFile.size)} · Ready for analysis`
                    : "or browse from your computer · JPG, PNG, MP4, WAV and more"}
                </p>
              </div>

              <div className="uploadActions">
                <button className="browseBtn" onClick={() => fileInputRef.current?.click()}>
                  Browse files
                </button>
                <button
                  className="analyzeBtn"
                  onClick={handleAnalyze}
                  disabled={!selectedFile || loading}
                >
                  {loading ? "Analyzing…" : "Analyze media  →"}
                </button>
              </div>
            </section>

            {error && <div className={`errorBar ${error.includes("copied") ? "info" : ""}`}>{error}</div>}

            <div className="securityNote">
              <span>⌁</span>
              Files are processed locally through your configured Authentix API. Results are estimates, not proof of authenticity.
            </div>
          </>
        )}
      </main>

      <button className="chiku" onClick={() => setShowHelp(true)}>
        <span className="chikuFace">◉</span>
        <span><small>Need help?</small> Chiku</span>
      </button>

      {showHelp && (
        <div className="modalBackdrop" onClick={() => setShowHelp(false)}>
          <div className="helpModal" onClick={(e) => e.stopPropagation()}>
            <button className="closeModal" onClick={() => setShowHelp(false)}>×</button>
            <div className="modalIcon">✦</div>
            <span className="eyebrow">HOW IT WORKS</span>
            <h2>Three steps to verify media</h2>
            <div className="steps">
              <div><b>01</b><span><strong>Upload</strong> an image, video or audio file.</span></div>
              <div><b>02</b><span><strong>Analyze</strong> it with the configured AI detector.</span></div>
              <div><b>03</b><span><strong>Review</strong> the verdict and confidence score.</span></div>
            </div>
            <p className="modalNote">A high confidence score is still an AI estimate. Always use human judgment for important decisions.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
