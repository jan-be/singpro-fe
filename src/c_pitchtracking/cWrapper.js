let Module = require('./pitchC.gen');

let version = Module().cwrap('version', 'number');
let getPitch = Module().cwrap('getPitch', 'number', ['array', 'number', 'number']);

module.exports = {
  version,
  getPitch,
  Module,
};