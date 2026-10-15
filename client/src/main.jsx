import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { Splash } from './components/Logo.jsx';
import Login from './pages/Login.jsx';
import SetupProfile from './pages/SetupProfile.jsx';
import Home from './pages/Home.jsx';
import Profile from './pages/Profile.jsx';
import PublicRooms from './pages/PublicRooms.jsx';
import Room from './pages/Room.jsx';
import './styles.css';

function Toasts() {
  const { toasts } = useAuth();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Guard({ children }) {
  const { user, needsProfile, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (needsProfile && loc.pathname !== '/setup') return <Navigate to="/setup" state={{ from: loc.pathname }} replace />;
  return children;
}

/** Splash stays up while the session loads, with a minimum dwell so the logo animation completes. */
function Boot({ children }) {
  const { loading } = useAuth();
  const [phase, setPhase] = useState('in'); // in | leaving | gone
  useEffect(() => {
    if (loading) return;
    const minDwell = setTimeout(() => setPhase('leaving'), 900);
    return () => clearTimeout(minDwell);
  }, [loading]);
  useEffect(() => {
    if (phase !== 'leaving') return;
    const t = setTimeout(() => setPhase('gone'), 480);
    return () => clearTimeout(t);
  }, [phase]);
  return (
    <>
      {phase !== 'gone' && <Splash leaving={phase === 'leaving'} />}
      {!loading && children}
    </>
  );
}

/** Re-keys the routed page on navigation so it fades in. */
function Page({ children }) {
  const loc = useLocation();
  return (
    <div key={loc.pathname} className="page-enter">
      {children}
    </div>
  );
}

function App() {
  return (
    <Boot>
      <Routes>
        <Route path="/login" element={<Page><Login /></Page>} />
        <Route path="/setup" element={<Guard><Page><SetupProfile /></Page></Guard>} />
        <Route path="/" element={<Guard><Page><Home /></Page></Guard>} />
        <Route path="/profile" element={<Guard><Page><Profile /></Page></Guard>} />
        <Route path="/rooms" element={<Guard><Page><PublicRooms /></Page></Guard>} />
        <Route path="/r/:code" element={<Guard><Room /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </Boot>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
