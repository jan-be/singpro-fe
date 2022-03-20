import React from "react";
import WrapperPage from "../WrapperPage";
import { Typography } from "@mui/material";
import { Email } from "react-obfuscate-email";

const ContactPage = () =>
  <WrapperPage>
    <Typography>
      Singpro inc. <br/>
      Contact: <Email email="singpro@janbe.eu">Send an E-Mail</Email>
    </Typography>
  </WrapperPage>;

export default ContactPage;
