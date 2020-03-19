#include "dywapitchtrack.h"
#include <stdio.h>
#include "emscripten.h"
//#include <math.h>

dywapitchtracker d = {-1, -1};

EMSCRIPTEN_KEEPALIVE
double getPitch(double *nums) {
    return dywapitch_computepitch(&d, nums, 0, 1024);
}

EMSCRIPTEN_KEEPALIVE
int version() {
    return 3;
}
