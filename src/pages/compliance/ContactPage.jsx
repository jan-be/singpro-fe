import React from "react";
import WrapperPage from "../WrapperPage";
import { Email } from "react-obfuscate-email";

const ContactPage = () =>
  <WrapperPage>
    <div className="text-gray-300">
      <p>singpro.app</p>
      <p>Contact: <Email email="hello@singpro.app">Send an E-Mail</Email></p>
    </div>
  </WrapperPage>;

export default ContactPage;
