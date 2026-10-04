import React from "react";
import WrapperPage from "../WrapperPage";
import PrivacyPolicyContent from "./content/PrivacyPolicyContent";

const PrivacyPolicyPage = () => (
  <WrapperPage>
    <div className="max-w-3xl mx-auto rounded-3xl bg-panel border border-white/10 px-5 py-8 sm:px-12 sm:py-12">
      <PrivacyPolicyContent />
    </div>
  </WrapperPage>
);

export default PrivacyPolicyPage;
