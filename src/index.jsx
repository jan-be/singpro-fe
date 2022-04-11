import React from 'react';
import { createRoot } from 'react-dom/client';
import MyRouter from "./MyRouter";

createRoot(document.getElementById('root'))
  .render(<MyRouter/>);
