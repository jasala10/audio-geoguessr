"use client";
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as maptilersdk from '@maptiler/sdk';
import "@maptiler/sdk/dist/maptiler-sdk.css";
import haversine from 'haversine-distance';

// ─── Constants ────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS = 5;
const MAX_SCORE_PER_ROUND = 5000;
const calcScore = (distKm) =>
  Math.max(0, Math.round(MAX_SCORE_PER_ROUND * (1 - distKm / 5000)));

// ─── Data fetching ────────────────────────────────────────────────────────────
const fetchRandomSound = async (attempt = 0) => {
  if (attempt > 5) throw new Error("Too many failed attempts");
  try {
    const randomPage = Math.floor(Math.random() * 1000) + 1;
    const searchUrl = `https://archive.org/advancedsearch.php?q=collection:(radio-aporee-maps)&rows=1&page=${randomPage}&output=json`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const identifier = searchData.response.docs[0]?.identifier;
    if (!identifier) throw new Error("No identifier found");

    const metaRes = await fetch(`https://archive.org/metadata/${identifier}`);
    const data = await metaRes.json();

    const mp3File = data.files?.find(f => f.format === "VBR MP3" || f.format === "MP3");
    const lat = data.metadata?.latitude;
    const lng = data.metadata?.longitude;

    if (!lat || !lng || !mp3File || !data.server || !data.dir) {
      return fetchRandomSound(attempt + 1);
    }

    const audioUrl = `https://${data.server}${data.dir}/${mp3File.name}`;
    const [, loc, snd] = identifier.split("_");

    return {
      identifier,
      title: data.metadata.title || "Unknown Location",
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      audioUrl,
      aporeeUrl: `https://aporee.org/maps/?loc=${loc}&snd=${snd}`,
      creator: data.metadata.creator || "Anonymous",
      description: (data.metadata.description || "").replace(/<[^>]*>/g, " ").trim()
    };
  } catch (err) {
    console.error("Fetch error:", err);
    return fetchRandomSound(attempt + 1);
  }
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function Map() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const audioRef = useRef(null);
  const guessMarker = useRef(null);
  const truthMarker = useRef(null);
  const isGuessedRef = useRef(false);
  const prefetchRef = useRef(null);

  const [phase, setPhase] = useState('start');
  const [round, setRound] = useState(0);
  const [rounds, setRounds] = useState([]);
  const [currentSound, setCurrentSound] = useState(null);
  const [guess, setGuess] = useState(null);
  const [roundResult, setRoundResult] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [submitState, setSubmitState] = useState('idle');
  const [submitResult, setSubmitResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState({ daily: [], alltime: [] });
  const [lbTab, setLbTab] = useState('daily');

  const totalScore = rounds.reduce((sum, r) => sum + r.score, 0);

  useEffect(() => {
    isGuessedRef.current = phase === 'roundOver' || phase === 'gameOver';
  }, [phase]);

  // Map init — identical to original working version
  useEffect(() => {
    if (map.current) return;
    maptilersdk.config.apiKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    map.current = new maptilersdk.Map({
      container: mapContainer.current,
      style: maptilersdk.MapStyle.DATAVIZ.DARK,
      center: [0, 0],
      zoom: 1
    });

    map.current.on('click', (e) => {
      if (isGuessedRef.current) return;
      const { lng, lat } = e.lngLat;
      setGuess({ lat, lng });
      if (!guessMarker.current) {
        guessMarker.current = new maptilersdk.Marker({ color: "#3FB1CE" })
          .setLngLat([lng, lat])
          .addTo(map.current);
      } else {
        guessMarker.current.setLngLat([lng, lat]);
      }
    });
  }, []);

  const clearMapMarkers = () => {
    if (guessMarker.current) { guessMarker.current.remove(); guessMarker.current = null; }
    if (truthMarker.current) { truthMarker.current.remove(); truthMarker.current = null; }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
  };

  const prefetchNext = useCallback(() => {
    prefetchRef.current = Promise.race([fetchRandomSound(), fetchRandomSound()]);
  }, []);

  const loadRound = useCallback(async (roundNum) => {
    setPhase('loading');
    setGuess(null);
    setRoundResult(null);
    clearMapMarkers();
    stopAudio();
    map.current?.flyTo({ center: [0, 0], zoom: 1, duration: 800 });

    let sound = null;
    if (prefetchRef.current) {
      sound = await prefetchRef.current;
      prefetchRef.current = null;
    }
    if (!sound) sound = await fetchRandomSound();

    setCurrentSound(sound);
    const audio = new Audio(sound.audioUrl);
    audio.preload = 'auto';
    audioRef.current = audio;
    audio.play();
    setRound(roundNum);
    setPhase('playing');
    if (roundNum < TOTAL_ROUNDS) prefetchNext();
  }, [prefetchNext]);

  const startGame = () => {
    prefetchRef.current = null;
    setRounds([]);
    setPlayerName('');
    setSubmitState('idle');
    setSubmitResult(null);
    loadRound(1);
  };

  const submitGuess = () => {
    if (!guess || !currentSound) return;
    const distM = haversine(
      { lat: guess.lat, lng: guess.lng },
      { lat: currentSound.lat, lng: currentSound.lng }
    );
    const distKm = Math.round(distM / 1000);
    const score = calcScore(distKm);

    truthMarker.current = new maptilersdk.Marker({ color: "#FF0000" })
      .setLngLat([currentSound.lng, currentSound.lat])
      .addTo(map.current);

    map.current.fitBounds(
      [[guess.lng, guess.lat], [currentSound.lng, currentSound.lat]],
      { padding: 150, maxZoom: 10, duration: 1500 }
    );

    setRoundResult({ distKm, score });
    setRounds(prev => [...prev, { sound: currentSound, distKm, score }]);
    setPhase('roundOver');
    stopAudio();
  };

  const nextRound = () => {
    if (round >= TOTAL_ROUNDS) {
      clearMapMarkers();
      map.current?.flyTo({ center: [0, 0], zoom: 1, duration: 800 });
      setPhase('gameOver');
    } else {
      loadRound(round + 1);
    }
  };

  const fetchLeaderboards = async () => {
    const [daily, alltime] = await Promise.all([
      fetch('/api/scores/daily').then(r => r.json()),
      fetch('/api/scores/alltime').then(r => r.json()),
    ]);
    setLeaderboard({ daily: daily.leaderboard || [], alltime: alltime.leaderboard || [] });
  };

  const submitScore = async () => {
    if (!playerName.trim()) return;
    setSubmitState('loading');
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: playerName.trim(),
          total_score: totalScore,
          round_scores: rounds.map(r => r.score),
          round_distances: rounds.map(r => r.distKm),
          clip_identifiers: rounds.map(r => r.sound.identifier),
        }),
      });
      const data = await res.json();
      if (res.status === 429) { setSubmitState('ratelimit'); return; }
      if (!res.ok) { setSubmitState('error'); return; }
      setSubmitResult(data);
      setSubmitState('success');
      fetchLeaderboards();
    } catch {
      setSubmitState('error');
    }
  };

  const shareScore = () => {
    const rank = submitResult?.dailyRank;
    const text = `I ranked #${rank} on Sonic GeoGuessr with ${totalScore.toLocaleString()} pts 🎧🌍\nCan you beat me?`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.href)}`;
    window.open(url, '_blank');
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'lative', width: '100%', height: '100vh' }}>
      <div ref={mapContainer} style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        width: '100vw', 
        height: '100vh', 
        zIndex: 0 
      }} />

      <div style={{
        position: 'absolute', top: '20px', left: '20px', zIndex: 10,
        background: 'white', padding: '20px', borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        width: '280px', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto'
      }}>

        {phase === 'start' && (
          <div>
            <p style={{ marginBottom: '10px', fontSize: '13px', color: '#555' }}>
              Listen to a field recording from somewhere on Earth. Pin your guess on the map.
            </p>
            <button onClick={startGame} style={btnStyle('#222', 'white')}>
              Start Game
            </button>
          </div>
        )}

        {phase === 'loading' && (
          <p style={{ fontSize: '13px', color: '#888' }}>Finding a sound…</p>
        )}

        {phase === 'playing' && (
          <div>
            <p style={{ marginBottom: '8px', fontSize: '13px' }}>🔊 Listening…</p>
            <p style={{ fontSize: '11px', color: '#888', marginBottom: '10px' }}>
              Click the map to place your guess, then submit.
            </p>
            <button onClick={submitGuess} disabled={!guess} style={btnStyle('#28a745', 'white')}>
              Submit Guess
            </button>
            <div style={{ marginTop: '8px', fontSize: '11px', color: '#aaa', textAlign: 'right' }}>
              Round {round} of {TOTAL_ROUNDS}
            </div>
          </div>
        )}

        {phase === 'roundOver' && roundResult && (
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '22px' }}>
              {roundResult.distKm.toLocaleString()} km away
            </h2>
            <p style={{ fontSize: '13px', color: '#28a745', marginBottom: '8px' }}>
              +{roundResult.score.toLocaleString()} pts
            </p>
            <p style={{ fontSize: '12px', color: '#666' }}>
              <strong>Location:</strong> {currentSound?.title}
            </p>
            <p style={{ fontSize: '11px', color: '#999', marginBottom: '4px' }}>
              <strong>Artist:</strong> {currentSound?.creator}
            </p>
            {currentSound?.description && (
              <p style={{ fontSize: '11px', color: '#888', marginBottom: '6px', fontStyle: 'italic' }}>
                {currentSound.description.slice(0, 120)}{currentSound.description.length > 120 ? '…' : ''}
              </p>
            )}
            {currentSound?.aporeeUrl && (
              <a href={currentSound.aporeeUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '11px', color: '#3FB1CE', display: 'block', marginBottom: '12px' }}>
                View on Radio Aporee ↗
              </a>
            )}
            <button onClick={nextRound} style={btnStyle('#222', 'white')}>
              {round >= TOTAL_ROUNDS ? 'See Final Score' : `Round ${round + 1} of ${TOTAL_ROUNDS} →`}
            </button>
          </div>
        )}

        {phase === 'gameOver' && (
          <div>
            <p style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Final Score
            </p>
            <h2 style={{ fontSize: '36px', margin: '0 0 4px 0' }}>
              {totalScore.toLocaleString()}
            </h2>
            <p style={{ fontSize: '12px', color: '#aaa', marginBottom: '12px' }}>
              out of {(MAX_SCORE_PER_ROUND * TOTAL_ROUNDS).toLocaleString()}
            </p>

            <div style={{ borderTop: '1px solid #eee', paddingTop: '10px', marginBottom: '14px' }}>
              {rounds.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', padding: '3px 0' }}>
                  <span>Round {i + 1} — {r.distKm.toLocaleString()} km</span>
                  <span style={{ color: '#28a745' }}>+{r.score.toLocaleString()}</span>
                </div>
              ))}
            </div>

            {submitState === 'idle' && (
              <div style={{ marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Your name"
                  maxLength={30}
                  value={playerName}
                  onChange={e => setPlayerName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submitScore()}
                  style={{
                    width: '100%', padding: '8px 10px', marginBottom: '8px',
                    border: '1px solid #ddd', borderRadius: '6px',
                    fontSize: '13px', boxSizing: 'border-box'
                  }}
                />
                <button onClick={submitScore} disabled={!playerName.trim()} style={btnStyle('#222', 'white')}>
                  Submit to Leaderboard
                </button>
              </div>
            )}

            {submitState === 'loading' && (
              <p style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>Submitting…</p>
            )}

            {submitState === 'ratelimit' && (
              <p style={{ fontSize: '12px', color: '#e53e3e', marginBottom: '10px' }}>
                You've submitted 5 times today. Come back tomorrow!
              </p>
            )}

            {submitState === 'error' && (
              <div style={{ marginBottom: '10px' }}>
                <p style={{ fontSize: '12px', color: '#e53e3e', marginBottom: '6px' }}>Something went wrong.</p>
                <button onClick={() => setSubmitState('idle')} style={btnStyle('#888', 'white')}>Retry</button>
              </div>
            )}

            {submitState === 'success' && submitResult && (
              <div style={{
                background: '#f0fff4', border: '1px solid #9ae6b4', borderRadius: '8px',
                padding: '10px', marginBottom: '12px', textAlign: 'center',
                fontSize: '13px', color: '#276749'
              }}>
                🎧 #{submitResult.dailyRank} on today's leaderboard!
              </div>
            )}

            {submitState === 'success' && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  {['daily', 'alltime'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => { setLbTab(tab); if (tab === 'alltime') fetchLeaderboards(); }}
                      style={{
                        flex: 1, padding: '5px', fontSize: '11px', cursor: 'pointer',
                        border: '1px solid #ddd', borderRadius: '6px',
                        background: lbTab === tab ? '#222' : 'white',
                        color: lbTab === tab ? 'white' : '#666'
                      }}
                    >
                      {tab === 'daily' ? 'Today' : 'All-time'}
                    </button>
                  ))}
                </div>
                {(lbTab === 'daily' ? leaderboard.daily : leaderboard.alltime).map((entry, i) => (
                  <div key={entry.id} style={{
                    display: 'flex', gap: '8px', fontSize: '11px', padding: '4px 6px', borderRadius: '4px',
                    background: entry.name === playerName.trim() && entry.total_score === totalScore ? '#f0fff4' : 'transparent'
                  }}>
                    <span style={{ color: '#aaa', width: '20px' }}>#{i + 1}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                    <span style={{ color: '#28a745', fontWeight: 600 }}>{entry.total_score.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            {submitState === 'success' && (
              <button onClick={shareScore} style={{ ...btnStyle('#000', 'white'), marginBottom: '8px' }}>
                Share on X / Twitter
              </button>
            )}

            <button onClick={startGame} style={btnStyle('#eee', '#333')}>
              Play Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(bg, color) {
  return {
    width: '100%', padding: '10px 14px', background: bg, color,
    border: 'none', borderRadius: '6px', cursor: 'pointer',
    fontSize: '13px', fontWeight: 600, marginBottom: '4px'
  };
}