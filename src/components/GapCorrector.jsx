import React from 'react';
import { Button, Input, Slider, Stack } from "@mui/material";
import { apiUrl } from "../GlobalConsts";

const GapCorrector = ({ songId, gapData }) => {

  const pushNewGap = (gap) => {
    fetch(`${apiUrl}/songs/${songId}`, {
      method: "PATCH",
      body: JSON.stringify({ gap }),
      headers: { "Content-Type": "application/json" },
    });
  };

  return (
    <Stack spacing={2} direction="row" sx={{ mb: 1 }} alignItems="center">
      <Slider value={gapData.gap} onChange={gapData.setGap} min={0} max={gapData.defaultGap * 2}
              defaultValue={gapData.defaultGap} color="secondary"/>
      <Input value={gapData.gap} onChange={gapData.setGap}/>
      <Button color="secondary" variant="outlined" onClick={() => {pushNewGap(gapData.gap);}}>Submit</Button>
    </Stack>
  );
};

export default GapCorrector;
