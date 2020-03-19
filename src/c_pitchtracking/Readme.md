# Recompiling the code

Emscripten is a fucking pain to use

after running the script you need to manually add 

```
/*eslint-disable*/
```

to the beginning of the code and in the generated .js file
you need to add a `/` the beginning of the .wasm file path
and comment out the next line in the if statement after that

And also you need to move the .wasm file to /public 