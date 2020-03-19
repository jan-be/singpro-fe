#include "dywapitchtrack.h"
#include <stdio.h>
#include "emscripten.h"
//#include <math.h>

EMSCRIPTEN_KEEPALIVE
double getPitch(double *nums, double previousPitch, int confidence) {
    dywapitchtracker d;
    d._prevPitch = previousPitch;
    d._pitchConfidence = confidence;

    return dywapitch_computepitch(&d, nums, 0, 1024);
}

EMSCRIPTEN_KEEPALIVE
int version() {
    return 3;
}
