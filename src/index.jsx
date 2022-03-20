import React from 'react';
import ReactDOM from 'react-dom';
import MyRouter from "./MyRouter";

// polyfills
import "core-js/stable";
import "isomorphic-fetch";

ReactDOM.render(
  <MyRouter/>,
  document.getElementById('root'));
