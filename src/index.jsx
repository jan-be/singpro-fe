import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/i18n'; // Initialize i18n before rendering
import './index.css';
import MyRouter from "./MyRouter";

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <MyRouter />
  </React.StrictMode>
);
