import React from "react";
import WrapperPage from "../WrapperPage";
import TermsOfServiceContent from "./content/TermsOfServiceContent";

const TermsOfServicePage = () => (
  <WrapperPage>
    <div className="max-w-3xl mx-auto rounded-3xl bg-panel border border-white/10 px-5 py-8 sm:px-12 sm:py-12">
      <TermsOfServiceContent />
    </div>
  </WrapperPage>
);

export default TermsOfServicePage;
