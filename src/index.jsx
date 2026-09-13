import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/i18n'; // Initialize i18n before rendering
import './index.css';
import MyRouter from "./MyRouter";
import { AuthProvider } from "./logic/AuthContext";
import { syncPitchGpuFlagFromUrl } from "./logic/pitchGpuFlag";

// ?gpu=1 / ?gpu=0 on any URL switches the opt-in GPU pitch detection for this browser
syncPitchGpuFlagFromUrl();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <MyRouter />
    </AuthProvider>
  </React.StrictMode>
);
