import React from 'react';
import { createRoot } from 'react-dom/client';
import MyRouter from "./MyRouter";

// polyfills
import "core-js/stable";
import "isomorphic-fetch";

createRoot(document.getElementById('root'))
  .render(<MyRouter/>);
