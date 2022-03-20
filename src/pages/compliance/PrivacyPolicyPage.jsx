import React from "react";
import { Link, Typography } from "@mui/material";
import WrapperPage from "../WrapperPage";

const PrivacyPolicyPage = () =>
  <WrapperPage>
    <Typography>
      Last updated: 19.03.2022<br/>
      Singpro itself does not collect any user data.<br/>
      However, it uses the YouTube Data API and embedded YouTube Videos, which may collect data. The embedded YouTube-Player may also serve advertisements
      and track user activity based on Google's Privacy Policy.<br/>
      YouTube is a Google service and it's Privacy Policy can be
      accessed at <Link target="_blank" rel="noopener" href="https://policies.google.com/privacy?hl=en-US">https://policies.google.com/privacy?hl=en-US</Link>.
    </Typography>
  </WrapperPage>;

export default PrivacyPolicyPage;
