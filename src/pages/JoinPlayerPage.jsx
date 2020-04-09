import React, { useState } from "react";
import { TextField, Button } from "@material-ui/core";
import { useHistory } from "react-router-dom";

const JoinPlayerPage = () => {

  const [partyId, setPartyId] = useState("");
  const history = useHistory();

  const handleChange = event => {
    let newVal = event.target.value;

    if (newVal.match(/^\d{0,6}$/)) {
      setPartyId(newVal);
    }
  };

  const handleSubmit = event => {
    event.preventDefault();
    history.push(`/mic/${partyId}`);
  };

  return (
    <div>
      <form onSubmit={handleSubmit} noValidate autoComplete="off">
        <TextField label="Party ID" inputProps={{inputMode: 'numeric', pattern: '[0-9]*' }} variant="outlined" value={partyId} onChange={handleChange}/>
        <Button type="submit">Join</Button>
      </form>
    </div>
  );
};

export default JoinPlayerPage;
