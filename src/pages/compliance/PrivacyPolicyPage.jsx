import React from "react";
import { Link, Typography } from "@mui/material";
import WrapperPage from "../WrapperPage";

const PrivacyPolicyPage = () =>
  <WrapperPage>
    <Typography>
      Last updated: 19.03.2022<br/>
      Singpro itself does not collect any user data.<br/>
      However, it uses the YouTube Data API and embedded YouTube Videos, which may collect data.<br/>
      YouTube is a Google service and it's Privacy Policy can be
      accessed <Link target="_blank" rel="noopener" href="https://policies.google.com/privacy?hl=en-US">here</Link>.
    </Typography>
  </WrapperPage>;

export default PrivacyPolicyPage;
