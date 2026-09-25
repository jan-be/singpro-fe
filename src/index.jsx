import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/i18n'; // Initialize i18n before rendering
import './index.css';
import MyRouter from "./MyRouter";
import { AuthProvider } from "./logic/AuthContext";
import { NotificationsProvider } from "./logic/NotificationsContext";
import { syncPitchGpuFlagFromUrl } from "./logic/pitchGpuFlag";
import { syncDebugFlagFromUrl, isDebugEnabled, installDebugHooks } from "./logic/debugLog";
import { captureReferrer } from "./logic/referrer";

// ?gpu=1 / ?gpu=0 on any URL switches the opt-in GPU pitch detection for this browser
syncPitchGpuFlagFromUrl();
// ?debug=1 / ?debug=0 turns the on-page debug console (DebugOverlay) on or off for this browser
syncDebugFlagFromUrl();
if (isDebugEnabled()) installDebugHooks();
// Before the router runs: a client-side navigation clears document.referrer
captureReferrer();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <NotificationsProvider>
        <MyRouter />
      </NotificationsProvider>
    </AuthProvider>
  </React.StrictMode>
);
