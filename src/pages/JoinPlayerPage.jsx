import React, { useState } from "react";
import { TextField, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";

const JoinPlayerPage = () => {

  const [partyId, setPartyId] = useState("");
  const [username, setUsername] = useState("");
  const navigate = useNavigate();

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
    <div>
      <form onSubmit={handleSubmit} noValidate autoComplete="off">
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
    </div>
  );
};

export default JoinPlayerPage;
