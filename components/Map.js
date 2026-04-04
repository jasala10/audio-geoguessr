"use client";
import React, { useEffect, useRef, useState } from 'react';
import * as maptilersdk from '@maptiler/sdk';
import "@maptiler/sdk/dist/maptiler-sdk.css";
import haversine from 'haversine-distance';

const fetchRandomSound = async (attempt = 0) => {
  if (attempt > 5) throw new Error("Too many failed attempts");
  try {
    const randomPage = Math.floor(Math.random() * 1000) + 1;
    const searchUrl = `https://archive.org/advancedsearch.php?q=collection:(radio-aporee-maps)&rows=1&page=${randomPage}&output=json`;
    
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const identifier = searchData.response.docs[0]?.identifier;

    if (!identifier) throw new Error("No identifier found");

    const metaUrl = `https://archive.org/metadata/${identifier}`;
    const metaRes = await fetch(metaUrl);
    const data = await metaRes.json();

    const mp3File = data.files?.find(f => f.format === "VBR MP3" || f.format === "MP3");
    const lat = data.metadata?.latitude;
    const lng = data.metadata?.longitude;

    if (!lat || !lng || !mp3File || !data.server || !data.dir) {
      console.log("Missing data for " + identifier + ", trying another...");
      return fetchRandomSound(attempt + 1);
    }

    const audioUrl = `https://${data.server}${data.dir}/${mp3File.name}`;
    
    const [, loc, snd] = identifier.split("_");
    const aporeeUrl = `https://aporee.org/maps/?loc=${loc}&snd=${snd}`;



    return {
      identifier,
      title: data.metadata.title || "Unknown Location",
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      audioUrl,
      aporeeUrl,
      creator: data.metadata.creator || "Anonymous",
      //description: data.metadata.description || ""
      description: (data.metadata.description || "").replace(/<[^>]*>/g, " ").trim()
    };
  } catch (err) {
    console.error("Fetch error:", err);
    return null;
  }
};


export default function Map() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const audioRef = useRef(null);
  
  const [currentSound, setCurrentSound] = useState(null);
  const [loading, setLoading] = useState(false);

  const [guess, setGuess] = useState(null);
  const [distance, setDistance] = useState(null);
  const [isGuessed, setIsGuessed] = useState(false);
  const guessMarker = useRef(null);
  const truthMarker = useRef(null);

  // FIX 1a: Add a ref to track isGuessed without causing stale closures
  const isGuessedRef = useRef(false);

  // FIX 1b: Keep the ref in sync with the state
  useEffect(() => {
    isGuessedRef.current = isGuessed;
  }, [isGuessed]);

  useEffect(() => {
    if (map.current) return;
    maptilersdk.config.apiKey = '2hsvNuv3XBh0PT2DJyt1';
    map.current = new maptilersdk.Map({
      container: mapContainer.current,
      style: maptilersdk.MapStyle.DATAVIZ.DARK,
      center: [0, 0],
      zoom: 1
    });

    // FIX 1c: Use the ref instead of the state variable
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
  }, []); // FIX 1d: Empty array — map is only initialized once

  const submitGuess = () => {
    if (!guess || !currentSound) return;

    const dist = haversine(
      { lat: guess.lat, lng: guess.lng },
      { lat: currentSound.lat, lng: currentSound.lng }
    );
    
    setDistance(Math.round(dist / 1000));
    setIsGuessed(true);

    truthMarker.current = new maptilersdk.Marker({ color: "#FF0000" })
      .setLngLat([currentSound.lng, currentSound.lat])
      .addTo(map.current);

    map.current.fitBounds([
      [guess.lng, guess.lat],
      [currentSound.lng, currentSound.lat]
    ], { padding: 150,
         maxZoom: 10,
         duration: 1500 
       });
  };

  const startGame = async () => {
    setGuess(null);
    setDistance(null);
    setIsGuessed(false);
    if (guessMarker.current) guessMarker.current.remove();
    if (truthMarker.current) truthMarker.current.remove();
    guessMarker.current = null;
    truthMarker.current = null;

    setLoading(true);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null; // FIX 3: fully release the old audio object
    }

    const sound = await fetchRandomSound();
    if (sound) {
      setCurrentSound(sound);
      audioRef.current = new Audio(sound.audioUrl);
      audioRef.current.play();
    }
    setLoading(false);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      
      <div style={{ 
        position: 'absolute', top: '20px', left: '20px', zIndex: 10, 
        background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
      }}>
        <button onClick={startGame} disabled={loading}>
          {loading ? "Finding a sound..." : "Start New Round"}
        </button>
        
        {currentSound && !isGuessed && (
          <div style={{ marginTop: '10px' }}>
            <p>🔊 Listening...</p>
            {guess && (
              <button 
                onClick={submitGuess} 
                style={{ background: '#28a745', color: 'white', border: 'none', padding: '10px', borderRadius: '5px', cursor: 'pointer', width: '100%' }}
              >
                Submit Guess
              </button>
            )}
          </div>
        )}

        {isGuessed && (
          <div style={{ marginTop: '15px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
            <h2 style={{ margin: '0 0 5px 0' }}>{distance} km away</h2>
            <p style={{ fontSize: '12px', color: '#666' }}>Location: {currentSound.title}</p>
            <p style={{ fontSize: '10px', color: '#999' }}>Artist: {currentSound.creator}</p>
            <p style={{ fontSize: '11px', color: '#888', marginTop: '6px' }}>{currentSound.description}</p>
            <a href={currentSound.aporeeUrl} target="_blank" rel="noopener noreferrer" 
              style={{ fontSize: '11px', color: '#3FB1CE' }}>
              View on Radio Aporee ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}