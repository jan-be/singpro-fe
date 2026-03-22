import React, { useRef, useState } from 'react';
import { Box, Button, Input, Popover, Slider, Stack } from "@mui/material";
import { apiUrl } from "../GlobalConsts";

const GapCorrector = ({ songId, gapData }) => {

  const lastTimeRef = useRef(performance.now());
  const [sliderValue, setSliderValue] = useState(0);
  const [buttonRef, setButtonRef] = useState();

  const pushNewGap = (gap) => {
    fetch(`${apiUrl}/songs/${songId}`, {
      method: "PATCH",
      body: JSON.stringify({ gap }),
      headers: { "Content-Type": "application/json" },
    });
  };

  const handleSliderChange = (e) => {
    let value = e.target.value;
    let time = performance.now();
    if (gapData.gap !== undefined && gapData.gap !== null) {
      let newValue = Math.max(0, gapData.gap + ((time - lastTimeRef.current) * 10 * (value * Math.abs(value))));
      gapData.setGap(newValue);
    }
    lastTimeRef.current = time;
    setSliderValue(value);
  };

  return (
    <>
      <Button onClick={e => setButtonRef(e.currentTarget)} color="secondary" variant="outlined">Fix timing</Button>
      <Popover anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
               transformOrigin={{ horizontal: "center", vertical: "top" }}
               open={Boolean(buttonRef)} anchorEl={buttonRef} onClose={() => setButtonRef(null)}>
        <Stack spacing={2} direction="column" sx={{ margin: 1 }} alignItems="center">

          <Slider marks={[{ value: 0 }]} value={sliderValue ?? 0} onChange={handleSliderChange}
                  min={-1} max={1} defaultValue={0} step={0.00001}
                  color="secondary" onChangeCommitted={() => setSliderValue(0)}/>

          <Box>
            <Input value={Math.floor(gapData.gap ?? 0)} onChange={(e) => gapData.setGap(e.target.value)}/>
            ms
          </Box>
          <Button color="secondary" variant="outlined"
                  onClick={() => {pushNewGap(Math.floor(gapData.gap));}}>Submit</Button>
        </Stack>
      </Popover>
    </>
  );
};

export default GapCorrector;
