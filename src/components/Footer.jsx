import { Box, Container, Stack, Link } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import React from "react";

const Footer = () => {

  return <Box
    component="footer"
    sx={{
      py: 3,
      px: 2,
      mt: 'auto',
      backgroundColor: (theme) =>
        theme.palette.mode === 'light'
          ? theme.palette.grey[200]
          : theme.palette.grey[800],
    }}
  >
    <Container maxWidth="sm">
      <Stack
        direction="row"
        spacing={2}
        justifyContent="center"
      >
        <Link underline="none" component={RouterLink} to="/privacy-policy">Privacy Policy</Link>
        <Link underline="none" component={RouterLink} to="/tos">Terms of Service</Link>
        <Link underline="none" component={RouterLink} to="/contact">Contact</Link>
      </Stack>
    </Container>
  </Box>;
};

export default Footer;
