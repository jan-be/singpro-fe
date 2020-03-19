export default new Promise((resolve) => {
  require('./pitchC.gen')()
    .then((module) => {
      let version = module.cwrap('version', 'number');
      let getPitch = module.cwrap('getPitch', 'number', ['array', 'number', 'number']);
      let showArray = module.cwrap('showArray', 'number', ['array', 'number']);

      resolve({
        version,
        getPitch,
        showArray,
        module,
      });
    })
});
