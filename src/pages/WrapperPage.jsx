import React from "react";
import { AppBar, Box, Container, CssBaseline, Toolbar, Link } from '@mui/material';
import Footer from "../components/Footer";
import { Link as RouterLink } from "react-router-dom";
import MyIcon from "../icon.svg?react";

const WrapperPage = props => {

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
      }}
    >
      <CssBaseline/>

      <AppBar position={"static"}>
        <Toolbar>
          <Link color="#FFF" underline="none" component={RouterLink} to="/">
            <MyIcon width="24" height="24"/>
            SingPro
          </Link>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ mt: 5 }}>

        {props.children}

      </Container>

      <Footer/>
    </Box>
  );
};

export default WrapperPage;
