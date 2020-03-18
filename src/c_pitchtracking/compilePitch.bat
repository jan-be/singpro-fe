emcc dywapitchtrack.c -o pitchC.js ^
-s EXPORTED_FUNCTIONS="['_getPitch']" ^
-s EXTRA_EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap']" ^
-s MODULARIZE=1 ^
-s ENVIRONMENT=web ^
-s EXPORT_ES6=1
