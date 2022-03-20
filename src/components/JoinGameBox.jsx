import React, { useState } from "react";
import { TextField, Button, Box, Switch } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { Cloud, Weekend } from "@mui/icons-material";

const JoinGameBox = () => {
  const [isOnline, setIsOnline] = useState(false);
  const [partyId, setPartyId] = useState("");
  const [username, setUsername] = useState("");
  const navigate = useNavigate();

  const handleToggle = (event) => {
    setIsOnline(event.target.checked);
  };

  const handlePartyIdChange = event => {
    let newVal = event.target.value;

    if (newVal.match(/^\d{0,6}$/)) {
      setPartyId(newVal);
    }
  };

  const handleUsernameChange = event => setUsername(event.target.value);

  const handleSubmit = event => {
    event.preventDefault();
    navigate(`/mic/${partyId}/${username}`);
  };

  return (
    <Box sx={{ m: 2 }}>
      <form onSubmit={handleSubmit} noValidate autoComplete="off">
        Over the Internet <Switch checkedIcon={<Weekend/>} icon={<Cloud/>} checked={isOnline}
                                  onChange={handleToggle}/> In the same room
        <div>
          <TextField label="Party ID" inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }} variant="outlined"
                     value={partyId} onChange={handlePartyIdChange}/>
        </div>
        <div>
          <TextField label="Username" variant="outlined" value={username} onChange={handleUsernameChange}/>
        </div>
        <div>
          <Button variant="outlined" type="submit">Join</Button>
        </div>
      </form>
    </Box>
  );
};

export default JoinGameBox;
