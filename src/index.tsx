import React from 'react';
import ReactDOM from 'react-dom';
import {Provider} from 'react-redux';
import './index.css';
import store from "./state/store";
import MyRouter from "./MyRouter";

ReactDOM.render(
  <Provider store={store}>
    <MyRouter/>
  </Provider>,
  document.getElementById('root'));
