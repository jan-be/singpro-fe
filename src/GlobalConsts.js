const isDev = import.meta.env.DEV;
export const apiUrl = isDev
  ? '/api'
  : `https://${window.location.hostname}/api`;
