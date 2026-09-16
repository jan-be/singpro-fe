import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/i18n'; // Initialize i18n before rendering
import './index.css';
import MyRouter from "./MyRouter";
import { AuthProvider } from "./logic/AuthContext";
import { syncPitchGpuFlagFromUrl } from "./logic/pitchGpuFlag";
import { captureReferrer } from "./logic/referrer";

// ?gpu=1 / ?gpu=0 on any URL switches the opt-in GPU pitch detection for this browser
syncPitchGpuFlagFromUrl();
// Before the router runs: a client-side navigation clears document.referrer
captureReferrer();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <MyRouter />
    </AuthProvider>
  </React.StrictMode>
);
