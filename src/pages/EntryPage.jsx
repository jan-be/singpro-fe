import React, { useState } from "react";
import { Button, Box, Container, Typography, Collapse } from '@mui/material';
import { Link } from 'react-router-dom';
import JoinGameBox from "../components/JoinGameBox";
import WrapperPage from "./WrapperPage";

const EntryPage = () => {

  const [joinOpened, setJoinOpened] = useState(false);

  return <WrapperPage>

    <Container component="main" sx={{ mt: 8, mb: 2 }} maxWidth="sm">
      <Typography variant="h2" component="h1" gutterBottom>
        SingPro
      </Typography>
      <Typography variant="h5" component="h2" gutterBottom>
        {'Sing all your favourite songs and compete with your friends!'}
      </Typography>
      <Box sx={{ mt: 6, p: 2 }}>
        <Button sx={{ m: 1 }} variant="contained" component={Link} to="/select-song">Start new game</Button>
        <Button sx={{ m: 1 }} variant="outlined" onClick={() => setJoinOpened(!joinOpened)}>Join game</Button>
        <Collapse in={joinOpened}>
          <JoinGameBox/>
        </Collapse>
      </Box>
    </Container>

  </WrapperPage>;
};

export default EntryPage;
