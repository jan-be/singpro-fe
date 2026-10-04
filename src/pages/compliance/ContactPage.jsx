import React from "react";
import WrapperPage from "../WrapperPage";
import ContactContent from "./content/ContactContent";

const ContactPage = () => (
  <WrapperPage>
    <div className="max-w-3xl mx-auto rounded-3xl bg-panel border border-white/10 px-5 py-8 sm:px-12 sm:py-12">
      <ContactContent />
    </div>
  </WrapperPage>
);

export default ContactPage;
