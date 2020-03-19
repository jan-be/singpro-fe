emcc ^
dywapitchtrack.c ^
pitchMain.c ^
-o pitchC.gen.js ^
-s ENVIRONMENT='web' ^
-s EXTRA_EXPORTED_RUNTIME_METHODS="['cwrap']" ^
-s MODULARIZE=1