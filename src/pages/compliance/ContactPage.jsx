import React from "react";
import WrapperPage from "../WrapperPage";
import { Email } from "react-obfuscate-email";

const ContactPage = () =>
  <WrapperPage>
    <div className="text-gray-300">
      <p>Singpro inc.</p>
      <p>Contact: <Email email="singpro@janbe.eu">Send an E-Mail</Email></p>
    </div>
  </WrapperPage>;

export default ContactPage;
