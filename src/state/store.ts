import { compose, createStore } from "redux";
import singproApp from "./reducers";

const store = createStore(
  singproApp,
  (((window as any).__REDUX_DEVTOOLS_EXTENSION__ && (window as any).__REDUX_DEVTOOLS_EXTENSION__()) || compose));

export default store;