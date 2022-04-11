import React, { useEffect, useState } from 'react';
import { Button, Input, Slider, Stack } from "@mui/material";
import { apiUrl } from "../GlobalConsts";

const GapCorrector = ({ songId, gapData }) => {

  const [lastTime, setLastTime] = useState(performance.now());
  const [sliderValue, setSliderValue] = useState(0);

  const pushNewGap = (gap) => {
    fetch(`${apiUrl}/songs/${songId}`, {
      method: "PATCH",
      body: JSON.stringify({ gap }),
      headers: { "Content-Type": "application/json" },
    });
  };

  useEffect(() => {
    if (gapData.gap !== undefined && gapData.gap != null) {
      let time = performance.now();

      let newValue = Math.max(0, gapData.gap + ((time - lastTime) * 10 * (sliderValue * Math.abs(sliderValue))));
      gapData.setGap(newValue);

      setLastTime(time);
    }
  }, [sliderValue, gapData]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack spacing={2} direction="row" sx={{ mb: 1 }} alignItems="center">
      <Slider value={sliderValue ?? 0} onChange={(e) => setSliderValue(e.target.value)} min={-1} max={1}
              defaultValue={0} step={0.00001} color="secondary" onChangeCommitted={() => setSliderValue(0)}/>
      <Input value={Math.floor(gapData.gap ?? 0)} onChange={(e) => gapData.setGap(e.target.value)}/>
      <Button color="secondary" variant="outlined"
              onClick={() => {pushNewGap(Math.floor(gapData.gap));}}>Submit</Button>
    </Stack>
  );
};

export default GapCorrector;
