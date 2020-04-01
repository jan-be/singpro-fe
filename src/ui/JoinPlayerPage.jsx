import React, { useState } from "react";
import { TextField, Button } from "@material-ui/core";
import { Redirect } from "react-router-dom";

const JoinPlayerPage = () => {

  const [partyId, setPartyId] = useState(0);
  const [redirect, setRedirect] = useState(false);

  const handleChange = event => {
    setPartyId(event.target.value);
  };

  const handleSubmit = event => {
    setRedirect(true);
  };

  return (
    <div>
      <form onSubmit={handleSubmit} noValidate autoComplete="off">
        <TextField label="Party ID" type="number" variant="outlined" value={partyId} onChange={handleChange}/>
        <Button type="submit">Join</Button>
      </form>

      {redirect && <Redirect to={`/mic/${partyId}`}/>}
    </div>
  )
};

export default JoinPlayerPage;
